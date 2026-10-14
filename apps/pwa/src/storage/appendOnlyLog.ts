import type { BlipEvent, BlipEventBody } from '@inkling/domain'
import { newId } from '@inkling/domain'
import type { StorageAdapter, StoredBlob } from './adapter'
import { sha256Hex } from './hash'
import { openDatabase, request, runTransaction } from './idb'

const DB_NAME = 'inkling'
const DB_VERSION = 1
const EVENTS = 'events'
const META = 'meta'
const BLOBS = 'blobs'
const DEVICE_KEY = 'deviceId'

interface StoredBlobRecord extends StoredBlob {
  blob: Blob
}

/**
 * Local-first, append-only storage on IndexedDB.
 *
 * Events are written with out-of-line auto-increment keys, so a stored event is
 * exactly the event — nothing is rewritten in place. Blobs are content-addressed
 * by SHA-256, so writes are idempotent and dedupe for free.
 */
export class AppendOnlyLog implements StorageAdapter {
  #db: IDBDatabase | null = null
  #initPromise: Promise<void> | null = null
  #deviceId = ''
  #seq = -1
  #listeners = new Set<() => void>()
  #objectUrls = new Map<string, string>()

  get deviceId(): string {
    return this.#deviceId
  }

  init(): Promise<void> {
    this.#initPromise ??= this.#doInit()
    return this.#initPromise
  }

  async #doInit(): Promise<void> {
    await this.#open()
    const storedDeviceId = await this.#getMeta(DEVICE_KEY)
    if (typeof storedDeviceId === 'string' && storedDeviceId) {
      this.#deviceId = storedDeviceId
    } else {
      this.#deviceId = newId()
      await this.#putMeta(DEVICE_KEY, this.#deviceId)
    }

    const events = await this.allEvents()
    this.#seq = events.reduce((max, event) => Math.max(max, event.seq), -1)
  }

  async #open(): Promise<void> {
    if (this.#db) return
    this.#db = await openDatabase(DB_NAME, DB_VERSION, (database) => {
      if (!database.objectStoreNames.contains(EVENTS)) {
        database.createObjectStore(EVENTS, { autoIncrement: true })
      }
      if (!database.objectStoreNames.contains(META)) {
        database.createObjectStore(META)
      }
      if (!database.objectStoreNames.contains(BLOBS)) {
        database.createObjectStore(BLOBS, { keyPath: 'hash' })
      }
    })
  }

  async allEvents(): Promise<BlipEvent[]> {
    const db = this.#requireDb()
    return runTransaction(db, EVENTS, 'readonly', (tx) =>
      request<BlipEvent[]>(tx.objectStore(EVENTS).getAll()),
    )
  }

  async append(body: BlipEventBody): Promise<BlipEvent> {
    const db = this.#requireDb()
    const event = {
      ...body,
      deviceId: this.#deviceId,
      seq: this.#seq + 1,
      at: new Date().toISOString(),
    } as BlipEvent
    await runTransaction(db, EVENTS, 'readwrite', (tx) => {
      tx.objectStore(EVENTS).add(event)
    })
    this.#seq += 1
    this.#emit()
    return event
  }

  async putBlob(file: Blob, mime?: string): Promise<StoredBlob> {
    const hash = await sha256Hex(await file.arrayBuffer())
    const record: StoredBlobRecord = {
      hash,
      mime: mime ?? (file.type || 'application/octet-stream'),
      size: file.size,
      blob: file,
    }
    const db = this.#requireDb()
    await runTransaction(db, BLOBS, 'readwrite', (tx) => {
      tx.objectStore(BLOBS).put(record)
    })
    return { hash, mime: record.mime, size: record.size }
  }

  async blobUrl(hash: string): Promise<string | null> {
    const cached = this.#objectUrls.get(hash)
    if (cached) return cached
    const db = this.#requireDb()
    const record = await runTransaction(db, BLOBS, 'readonly', (tx) =>
      request<StoredBlobRecord | undefined>(tx.objectStore(BLOBS).get(hash)),
    )
    if (!record) return null
    const url = URL.createObjectURL(record.blob)
    this.#objectUrls.set(hash, url)
    return url
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

  #emit(): void {
    for (const listener of this.#listeners) listener()
  }

  #requireDb(): IDBDatabase {
    if (!this.#db) throw new Error('AppendOnlyLog.init() has not been called')
    return this.#db
  }

  async #getMeta(key: string): Promise<unknown> {
    const db = this.#requireDb()
    return runTransaction(db, META, 'readonly', (tx) => request(tx.objectStore(META).get(key)))
  }

  async #putMeta(key: string, value: string): Promise<void> {
    const db = this.#requireDb()
    await runTransaction(db, META, 'readwrite', (tx) => {
      tx.objectStore(META).put(value, key)
    })
  }
}
