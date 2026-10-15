import type { BlipEvent, BlipEventBody } from '@inkling/domain'
import { eventKey, newId, serializeLog, serializeLogBytes, sha256Hex } from '@inkling/domain'
import type { StorageAdapter, StoredBlob } from './adapter'
import { openDatabase, request, runTransaction } from './idb'

const DB_NAME = 'inkling'
const DB_VERSION = 2
const EVENTS = 'events'
const META = 'meta'
const BLOBS = 'blobs'
const SEEN = 'seen'
const DEVICE_KEY = 'deviceId'

interface StoredBlobRecord extends StoredBlob {
  blob: Blob
}

/** BlobPart wants a concretely-typed buffer, so copy into a fresh one. */
function toBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

/**
 * Local-first, append-only storage on IndexedDB.
 *
 * Events are written with out-of-line auto-increment keys, so a stored event is
 * exactly the event — nothing is rewritten in place. Blobs are content-addressed
 * by SHA-256, so writes are idempotent and dedupe for free.
 *
 * The `seen` store maps `deviceId:seq` to a marker. It makes ingesting a peer's log
 * idempotent: replaying the same bytes adds nothing, which is what lets sync be a
 * plain set-union with no merge step.
 */
export class AppendOnlyLog implements StorageAdapter {
  #db: IDBDatabase | null = null
  #initPromise: Promise<void> | null = null
  #deviceId = ''
  #seq = -1
  #listeners = new Set<() => void>()
  #objectUrls = new Map<string, string>()
  /** The database name. One per account, so two accounts never share a local log. */
  readonly #name: string

  constructor(name: string = DB_NAME) {
    this.#name = name
  }

  get deviceId(): string {
    return this.#deviceId
  }

  init(): Promise<void> {
    this.#initPromise ??= this.#doInit()
    return this.#initPromise
  }

  async #doInit(): Promise<void> {
    await this.#open()
    const storedDeviceId = await this.#readSetting(DEVICE_KEY)
    if (storedDeviceId) {
      this.#deviceId = storedDeviceId
    } else {
      this.#deviceId = newId()
      await this.#writeSetting(DEVICE_KEY, this.#deviceId)
    }

    const events = await this.#readAllEvents()
    this.#seq = events
      .filter((event) => event.deviceId === this.#deviceId)
      .reduce((max, event) => Math.max(max, event.seq), -1)
  }

  async #open(): Promise<void> {
    if (this.#db) return
    this.#db = await openDatabase(this.#name, DB_VERSION, (database, transaction) => {
      if (!database.objectStoreNames.contains(EVENTS)) {
        database.createObjectStore(EVENTS, { autoIncrement: true })
      }
      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(META)
      }
      if (!database.objectStoreNames.contains(BLOBS)) {
        database.createObjectStore(BLOBS, { keyPath: 'hash' })
      }
      if (!database.objectStoreNames.contains(SEEN)) {
        database.createObjectStore(SEEN)
        // Backfill from any events written before the dedupe index existed, so a
        // peer replaying our history cannot re-add it.
        const events = transaction?.objectStore(EVENTS)
        if (events) {
          events.openCursor().onsuccess = (cursorEvent) => {
            const cursor = (cursorEvent.target as IDBRequest<IDBCursorWithValue | null>).result
            if (!cursor) return
            const event = cursor.value as BlipEvent
            transaction?.objectStore(SEEN).put(true, eventKey(event))
            cursor.continue()
          }
        }
      }
    })
  }

  async allEvents(): Promise<BlipEvent[]> {
    await this.init()
    return this.#readAllEvents()
  }

  /** The raw read, for use during init itself — where calling init would deadlock. */
  async #readAllEvents(): Promise<BlipEvent[]> {
    const db = this.#requireDb()
    return runTransaction(db, EVENTS, 'readonly', (tx) =>
      request<BlipEvent[]>(tx.objectStore(EVENTS).getAll()),
    )
  }

  async append(body: BlipEventBody): Promise<BlipEvent> {
    await this.init()
    const db = this.#requireDb()
    const event = {
      ...body,
      deviceId: this.#deviceId,
      seq: this.#seq + 1,
      at: new Date().toISOString(),
    } as BlipEvent

    await runTransaction(
      db,
      [EVENTS, SEEN],
      'readwrite',
      (tx) => {
        tx.objectStore(EVENTS).add(event)
        tx.objectStore(SEEN).put(true, eventKey(event))
      },
      'strict',
    )
    this.#seq += 1
    this.#emit()
    return event
  }

  /**
   * Ingest events from a peer. Idempotent: events already seen are skipped, so the
   * same log segment can be replayed safely.
   */
  async appendRemote(events: BlipEvent[]): Promise<number> {
    if (events.length === 0) return 0
    await this.init()
    const db = this.#requireDb()
    let added = 0
    await runTransaction(
      db,
      [EVENTS, SEEN],
      'readwrite',
      (tx) => {
        const eventsStore = tx.objectStore(EVENTS)
        const seenStore = tx.objectStore(SEEN)
        for (const event of events) {
          const key = eventKey(event)
          const check = seenStore.get(key)
          check.onsuccess = () => {
            if (check.result !== undefined) return
            seenStore.put(true, key)
            eventsStore.add(event)
            added += 1
          }
        }
      },
      'strict',
    )
    if (added > 0) this.#emit()
    return added
  }

  /** This device's own log, serialized to the JSONL wire format. */
  async localLogText(): Promise<string> {
    return serializeLog(await this.allEvents(), this.#deviceId)
  }

  /** This device's own log as UTF-8 bytes. Sync offsets are byte offsets. */
  async localLogBytes(): Promise<Uint8Array> {
    return serializeLogBytes(await this.allEvents(), this.#deviceId)
  }

  async putBlob(file: Blob, mime?: string): Promise<StoredBlob> {
    const hash = await sha256Hex(new Uint8Array(await file.arrayBuffer()))
    const record: StoredBlobRecord = {
      hash,
      mime: mime ?? (file.type || 'application/octet-stream'),
      size: file.size,
      blob: file,
    }
    await this.init()
    const db = this.#requireDb()
    await runTransaction(
      db,
      BLOBS,
      'readwrite',
      (tx) => {
        tx.objectStore(BLOBS).put(record)
      },
      'strict',
    )
    return { hash, mime: record.mime, size: record.size }
  }

  async putBlobBytes(hash: string, bytes: Uint8Array, mime: string): Promise<void> {
    const record: StoredBlobRecord = {
      hash,
      mime,
      size: bytes.byteLength,
      blob: new Blob([toBuffer(bytes)], { type: mime }),
    }
    await this.init()
    const db = this.#requireDb()
    await runTransaction(
      db,
      BLOBS,
      'readwrite',
      (tx) => {
        tx.objectStore(BLOBS).put(record)
      },
      'strict',
    )
  }

  async blobBytes(hash: string): Promise<Uint8Array | null> {
    const record = await this.#blobRecord(hash)
    if (!record) return null
    return new Uint8Array(await record.blob.arrayBuffer())
  }

  async localBlobHashes(): Promise<string[]> {
    await this.init()
    const db = this.#requireDb()
    const keys = await runTransaction(db, BLOBS, 'readonly', (tx) =>
      request<IDBValidKey[]>(tx.objectStore(BLOBS).getAllKeys()),
    )
    return keys.map(String)
  }

  async blobUrl(hash: string): Promise<string | null> {
    const cached = this.#objectUrls.get(hash)
    if (cached) return cached
    const record = await this.#blobRecord(hash)
    if (!record) return null
    const url = URL.createObjectURL(record.blob)
    this.#objectUrls.set(hash, url)
    return url
  }

  async getSetting(key: string): Promise<string | null> {
    await this.init()
    return this.#readSetting(key)
  }

  async setSetting(key: string, value: string): Promise<void> {
    await this.init()
    await this.#writeSetting(key, value)
  }

  /**
   * The raw settings reads and writes.
   *
   * Separate from the public pair because `init()` uses them, and an `init()` that
   * awaits a method which awaits `init()` waits for itself forever — which is exactly
   * what happened the first time this was written.
   */
  async #readSetting(key: string): Promise<string | null> {
    const db = this.#requireDb()
    const value = await runTransaction(db, META, 'readonly', (tx) =>
      request<unknown>(tx.objectStore(META).get(key)),
    )
    return typeof value === 'string' ? value : null
  }

  async #writeSetting(key: string, value: string): Promise<void> {
    const db = this.#requireDb()
    await runTransaction(
      db,
      META,
      'readwrite',
      (tx) => {
        tx.objectStore(META).put(value, key)
      },
      'strict',
    )
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  async storageEstimate(): Promise<{ usage: number; quota: number } | null> {
    if (!navigator.storage?.estimate) return null
    const { usage = 0, quota = 0 } = await navigator.storage.estimate()
    return { usage, quota }
  }

  async #blobRecord(hash: string): Promise<StoredBlobRecord | undefined> {
    await this.init()
    const db = this.#requireDb()
    return runTransaction(db, BLOBS, 'readonly', (tx) =>
      request<StoredBlobRecord | undefined>(tx.objectStore(BLOBS).get(hash)),
    )
  }

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }

  #requireDb(): IDBDatabase {
    if (!this.#db) throw new Error('AppendOnlyLog.init() has not been called')
    return this.#db
  }
}
