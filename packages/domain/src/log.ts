import type { BlipEvent } from './events'

/**
 * The log wire format.
 *
 * A device's log is JSONL: one event per line, ordered by that device's `seq`.
 * Two properties make sync trivial, and both are load-bearing:
 *
 *   1. Serialization is byte-stable — appending events never changes the bytes of
 *      earlier lines. So a peer can be sent "everything past offset N" and the
 *      offsets never drift.
 *   2. Events have a stable identity across devices (`deviceId:seq`), so ingesting
 *      the same event twice is a no-op. Sync is set-union; there is no merge to do.
 */

/** Stable identity of an event: a device's own sequence number. */
export function eventKey(event: Pick<BlipEvent, 'deviceId' | 'seq'>): string {
  return `${event.deviceId}:${event.seq}`
}

/** Serialize one device's log to JSONL, ordered by `seq`. Byte-stable. */
export function serializeLog(events: BlipEvent[], deviceId: string): string {
  const lines = events
    .filter((event) => event.deviceId === deviceId)
    .sort((a, b) => a.seq - b.seq)
    .map((event) => JSON.stringify(event))
  return lines.length > 0 ? `${lines.join('\n')}\n` : ''
}

/** Parse JSONL produced by {@link serializeLog}. Throws on a malformed line. */
export function parseLog(text: string): BlipEvent[] {
  const out: BlipEvent[] = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parsed = JSON.parse(trimmed) as BlipEvent
    if (typeof parsed?.deviceId !== 'string' || typeof parsed?.seq !== 'number') {
      throw new Error('log line is not a well-formed event')
    }
    out.push(parsed)
  }
  return out
}

/**
 * UTF-8 bytes of a serialized log.
 *
 * Offsets on the wire are BYTE offsets (the server reports file sizes), so callers
 * must slice bytes, never string indices. A blip with an em dash makes
 * `text.length` and `bytes.length` disagree, and slicing by the wrong one splits a
 * line in half.
 */
export function serializeLogBytes(events: BlipEvent[], deviceId: string): Uint8Array {
  return new TextEncoder().encode(serializeLog(events, deviceId))
}

export interface MergeResult {
  /** Events not previously seen, in the order given. */
  added: BlipEvent[]
  /** How many incoming events were already known. */
  skipped: number
}

/** Merge incoming events, dropping any already seen. Idempotent by construction. */
export function mergeEvents(local: BlipEvent[], incoming: BlipEvent[]): MergeResult {
  const seen = new Set(local.map(eventKey))
  const added: BlipEvent[] = []
  let skipped = 0
  for (const event of incoming) {
    const key = eventKey(event)
    if (seen.has(key)) {
      skipped += 1
      continue
    }
    seen.add(key)
    added.push(event)
  }
  return { added, skipped }
}

/** Every device id present in a set of events, with how many events each contributed. */
export function devicesIn(events: BlipEvent[]): Array<{ deviceId: string; count: number }> {
  const counts = new Map<string, number>()
  for (const event of events) counts.set(event.deviceId, (counts.get(event.deviceId) ?? 0) + 1)
  return [...counts.entries()]
    .map(([deviceId, count]) => ({ deviceId, count }))
    .sort((a, b) => a.deviceId.localeCompare(b.deviceId))
}
