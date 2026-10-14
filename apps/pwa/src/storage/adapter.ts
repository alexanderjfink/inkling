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
 * `MdbaseAdapter` writes typed Markdown records and a future `SyncAdapter`
 * wraps this one to push/pull log segments — neither changes the app.
 */
export interface StorageAdapter {
  readonly deviceId: string
  init(): Promise<void>
  /** Every event this device knows about, in insertion order. */
  allEvents(): Promise<BlipEvent[]>
  /** Append one event. Returns the stored event with its device/seq/timestamp meta. */
  append(body: BlipEventBody): Promise<BlipEvent>
  putBlob(file: Blob, mime?: string): Promise<StoredBlob>
  blobUrl(hash: string): Promise<string | null>
  subscribe(listener: () => void): () => void
  storageEstimate(): Promise<{ usage: number; quota: number } | null>
}
