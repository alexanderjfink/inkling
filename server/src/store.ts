import { appendFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * The server is deliberately dumb: it stores each device's log as an append-only
 * file and blobs as content-addressed files. It never rewrites or deletes, so a
 * backup is a copy of the directory, and a bug can lose at most the last append.
 *
 * The log layout mirrors the client's exactly (`<deviceId>.jsonl`, JSONL), and the
 * server enforces that a device may only append to its own log — which is what makes
 * concurrent writes from two devices conflict-free rather than merely unlikely.
 */

export interface DeviceLogInfo {
  deviceId: string
  size: number
}

export interface Store {
  appendLog(deviceId: string, bytes: Uint8Array): Promise<number>
  readLog(deviceId: string, offset: number): Promise<Uint8Array>
  logSize(deviceId: string): Promise<number>
  devices(): Promise<DeviceLogInfo[]>
  hasBlob(hash: string): Promise<boolean>
  putBlob(hash: string, bytes: Uint8Array): Promise<void>
  getBlob(hash: string): Promise<Uint8Array | null>
  putDigest(deviceId: string, digest: string): Promise<void>
  digests(): Promise<Array<{ deviceId: string; digest: string }>>
}

const SAFE_DEVICE_ID = /^[A-Za-z0-9_-]{4,64}$/
const SAFE_HASH = /^[a-f0-9]{64}$/

export function isSafeDeviceId(id: string): boolean {
  return SAFE_DEVICE_ID.test(id)
}

export function isSafeHash(hash: string): boolean {
  return SAFE_HASH.test(hash)
}

export class FileStore implements Store {
  readonly #root: string

  constructor(root: string) {
    this.#root = root
  }

  #logPath(deviceId: string): string {
    return join(this.#root, 'logs', `${deviceId}.jsonl`)
  }

  #blobPath(hash: string): string {
    return join(this.#root, 'blobs', hash)
  }

  #digestPath(deviceId: string): string {
    return join(this.#root, 'digests', `${deviceId}.txt`)
  }

  async #sizeOf(path: string): Promise<number> {
    try {
      return (await stat(path)).size
    } catch {
      return 0
    }
  }

  async appendLog(deviceId: string, bytes: Uint8Array): Promise<number> {
    const path = this.#logPath(deviceId)
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, bytes)
    return this.#sizeOf(path)
  }

  async readLog(deviceId: string, offset: number): Promise<Uint8Array> {
    const path = this.#logPath(deviceId)
    try {
      const buffer = await readFile(path)
      return new Uint8Array(buffer.buffer, buffer.byteOffset + offset, buffer.byteLength - offset)
    } catch {
      return new Uint8Array(0)
    }
  }

  logSize(deviceId: string): Promise<number> {
    return this.#sizeOf(this.#logPath(deviceId))
  }

  async devices(): Promise<DeviceLogInfo[]> {
    const dir = join(this.#root, 'logs')
    try {
      const entries = await readdir(dir)
      const logs: DeviceLogInfo[] = []
      for (const entry of entries) {
        if (!entry.endsWith('.jsonl')) continue
        const deviceId = entry.slice(0, -'.jsonl'.length)
        logs.push({ deviceId, size: await this.#sizeOf(join(dir, entry)) })
      }
      return logs.sort((a, b) => a.deviceId.localeCompare(b.deviceId))
    } catch {
      return []
    }
  }

  async hasBlob(hash: string): Promise<boolean> {
    return (await this.#sizeOf(this.#blobPath(hash))) > 0
  }

  async putBlob(hash: string, bytes: Uint8Array): Promise<void> {
    const path = this.#blobPath(hash)
    if (await this.hasBlob(hash)) return
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, bytes)
  }

  async getBlob(hash: string): Promise<Uint8Array | null> {
    try {
      const buffer = await readFile(this.#blobPath(hash))
      return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
    } catch {
      return null
    }
  }

  async putDigest(deviceId: string, digest: string): Promise<void> {
    const path = this.#digestPath(deviceId)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, digest)
  }

  async digests(): Promise<Array<{ deviceId: string; digest: string }>> {
    const dir = join(this.#root, 'digests')
    try {
      const entries = await readdir(dir)
      const out: Array<{ deviceId: string; digest: string }> = []
      for (const entry of entries) {
        if (!entry.endsWith('.txt')) continue
        const digest = (await readFile(join(dir, entry), 'utf8')).trim()
        out.push({ deviceId: entry.slice(0, -'.txt'.length), digest })
      }
      return out.sort((a, b) => a.deviceId.localeCompare(b.deviceId))
    } catch {
      return []
    }
  }
}
