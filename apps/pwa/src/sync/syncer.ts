import type { BlipEvent, Block } from '@inkling/domain'
import { parseLog, stateDigest } from '@inkling/domain'
import { defaultServerUrl } from '../native'
import type { StorageAdapter } from '../storage/adapter'
import type { SyncTransport } from './transport'

export const SERVER_URL_KEY = 'sync:serverUrl'
export const DEFAULT_SERVER_URL = defaultServerUrl()
const PUSHED_KEY = 'sync:pushedOffset'
const NEWLINE = 0x0a
const watermarkKey = (deviceId: string) => `sync:watermark:${deviceId}`

export interface SyncReport {
  ok: boolean
  error?: string
  pushedBytes: number
  addedEvents: number
  peers: number
  blobsUp: number
  blobsDown: number
  /** First 8 chars of this device's state digest, for eyeballing across devices. */
  digest: string
  /** True when every other device published the same digest. */
  converged: boolean
  at: string
}

function blockHashes(block: Block): string[] {
  return block.items
    .map((item) => item.mediaId)
    .filter((hash): hash is string => typeof hash === 'string' && hash.length > 0)
}

export function referencedHashes(events: BlipEvent[]): Set<string> {
  const hashes = new Set<string>()
  for (const event of events) {
    if (event.t === 'captured') {
      if (event.input.mediaId) hashes.add(event.input.mediaId)
      for (const id of event.mediaIds ?? []) hashes.add(id)
    } else if (event.t === 'entry' && event.entry.mediaId) {
      hashes.add(event.entry.mediaId)
    } else if (event.t === 'blockAdded') {
      // A grid of images is media too. Without this its blobs would never move.
      for (const id of blockHashes(event.block)) hashes.add(id)
    } else if (event.t === 'blockUpdated' && event.patch.items) {
      for (const id of blockHashes({ id: event.blockId, kind: 'grid', items: event.patch.items })) {
        hashes.add(id)
      }
    }
  }
  return hashes
}

export function mimeFor(events: BlipEvent[], hash: string): string {
  for (const event of events) {
    if (
      event.t === 'captured' &&
      (event.input.mediaId === hash || event.mediaIds?.includes(hash))
    ) {
      return event.input.mime ?? 'application/octet-stream'
    }
    if (event.t === 'blockAdded') {
      const item = event.block.items.find((row) => row.mediaId === hash)
      if (item?.mime) return item.mime
    }
    if (event.t === 'blockUpdated') {
      const item = event.patch.items?.find((row) => row.mediaId === hash)
      if (item?.mime) return item.mime
    }
  }
  return 'application/octet-stream'
}

/**
 * One sync pass:
 *   1. push the tail of our own log (bytes past the offset the server already has)
 *   2. pull every peer log past our stored watermark, and ingest it idempotently
 *   3. move blobs both ways, skipping any the other side already has
 *
 * Every step is resumable and repeatable, so a failure just means the next pass
 * does more work — never that something is lost or duplicated.
 *
 * Offsets are BYTE offsets throughout: the server stores UTF-8 and reports file
 * sizes. Mixing those with JavaScript string indices splits a line in half the
 * moment a blip contains an em dash.
 */
export class Syncer {
  #store: StorageAdapter
  #transport: SyncTransport

  constructor(store: StorageAdapter, transport: SyncTransport) {
    this.#store = store
    this.#transport = transport
  }

  /** A usable byte offset for our own log, self-healing if the stored one is bad. */
  async #pushOffset(bytes: Uint8Array, serverSize: number): Promise<number> {
    const stored = Number((await this.#store.getSetting(PUSHED_KEY)) ?? '0')
    const atBoundary = (offset: number) => offset === 0 || bytes[offset - 1] === NEWLINE
    if (stored <= bytes.length && atBoundary(stored)) return stored

    // The stored offset is unusable — written by an older version, or the log
    // diverged. The server's size for our own log is authoritative when it lands
    // on a line boundary; otherwise replay from zero (ingest dedupes by device:seq,
    // so a replay costs bytes, never correctness).
    const recovered = serverSize <= bytes.length && atBoundary(serverSize) ? serverSize : 0
    await this.#store.setSetting(PUSHED_KEY, String(recovered))
    return recovered
  }

  async sync(): Promise<SyncReport> {
    const report: SyncReport = {
      ok: true,
      pushedBytes: 0,
      addedEvents: 0,
      peers: 0,
      blobsUp: 0,
      blobsDown: 0,
      digest: '',
      converged: false,
      at: new Date().toISOString(),
    }

    try {
      if (!(await this.#transport.health())) throw new Error('server unreachable')

      const devices = await this.#transport.devices()
      report.peers = devices.length
      const ourServerSize =
        devices.find((peer) => peer.deviceId === this.#store.deviceId)?.size ?? 0

      // 1. push our own tail
      const bytes = await this.#store.localLogBytes()
      const offset = await this.#pushOffset(bytes, ourServerSize)
      if (bytes.length > offset) {
        const payload = bytes.slice(offset)
        const { size } = await this.#transport.push(this.#store.deviceId, payload)
        report.pushedBytes = payload.length
        await this.#store.setSetting(PUSHED_KEY, String(size))
      }

      // 2. pull peers
      for (const peer of devices) {
        if (peer.deviceId === this.#store.deviceId) continue
        const key = watermarkKey(peer.deviceId)
        const watermark = Number((await this.#store.getSetting(key)) ?? '0')
        if (peer.size <= watermark) continue
        const { text, size } = await this.#transport.pull(peer.deviceId, watermark)
        if (text) {
          report.addedEvents += await this.#store.appendRemote(parseLog(text))
        }
        await this.#store.setSetting(key, String(size))
      }

      // 3. blobs
      const events = await this.#store.allEvents()
      const local = new Set(await this.#store.localBlobHashes())

      for (const hash of referencedHashes(events)) {
        if (local.has(hash)) continue
        const blob = await this.#transport.getBlob(hash)
        if (!blob) continue
        await this.#store.putBlobBytes(hash, blob, mimeFor(events, hash))
        report.blobsDown += 1
      }

      for (const hash of local) {
        if (await this.#transport.hasBlob(hash)) continue
        const blob = await this.#store.blobBytes(hash)
        if (!blob) continue
        await this.#transport.putBlob(hash, blob)
        report.blobsUp += 1
      }

      // 4. publish our state digest and compare with the other devices
      const digest = await stateDigest(events)
      report.digest = digest.slice(0, 8)
      await this.#transport.putDigest(this.#store.deviceId, digest)
      const published = await this.#transport.digests()
      const others = published.filter((entry) => entry.deviceId !== this.#store.deviceId)
      report.converged = others.length > 0 && others.every((entry) => entry.digest === digest)
    } catch (error) {
      report.ok = false
      report.error = error instanceof Error ? error.message : String(error)
    }

    return report
  }
}
