import type { BlipEvent, BlipEventBody } from '@inkling/domain'

export interface StoredBlob {
  hash: string
  mime: string
  size: number
}

/**
 * The seam between the app and wherever data lives.
 *
 * `AppendOnlyLog` (IndexedDB + blobs) is the current implementation. A future
 * `MdbaseAdapter` writes typed Markdown records; `SyncTransport` (see ../sync) is a
 * separate seam for moving logs between devices. Neither changes the app.
 */
export interface StorageAdapter {
  readonly deviceId: string
  init(): Promise<void>
  /** Every event this device knows about, in insertion order. */
  allEvents(): Promise<BlipEvent[]>
  /** Append one event. Returns the stored event with its device/seq/timestamp meta. */
  append(body: BlipEventBody): Promise<BlipEvent>
  /** Ingest a peer's events. Idempotent — already-seen events are skipped. */
  appendRemote(events: BlipEvent[]): Promise<number>
  /** This device's own log as UTF-8 bytes. Sync offsets are byte offsets. */
  localLogBytes(): Promise<Uint8Array>
  putBlob(file: Blob, mime?: string): Promise<StoredBlob>
  putBlobBytes(hash: string, bytes: Uint8Array, mime: string): Promise<void>
  blobBytes(hash: string): Promise<Uint8Array | null>
  localBlobHashes(): Promise<string[]>
  blobUrl(hash: string): Promise<string | null>
  getSetting(key: string): Promise<string | null>
  setSetting(key: string, value: string): Promise<void>
  subscribe(listener: () => void): () => void
  storageEstimate(): Promise<{ usage: number; quota: number } | null>
}
