/**
 * Lexicographically sortable, ULID-style identifiers.
 *
 * The first 10 characters encode the millisecond timestamp in Crockford base32,
 * so ids sort by creation time; the remaining 16 are random. Deterministic
 * ordering matters because the event log folds in id order.
 */

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'

function encodeTime(time: number, length: number): string {
  let remaining = time
  let out = ''
  for (let i = length - 1; i >= 0; i--) {
    out = (ENCODING[remaining % 32] ?? '') + out
    remaining = Math.floor(remaining / 32)
  }
  return out
}

function randomChars(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < length; i++) out += ENCODING[(bytes[i] ?? 0) % 32] ?? ''
  return out
}

/** Create a new time-sortable id. */
export function newId(now: number = Date.now()): string {
  return encodeTime(now, 10) + randomChars(16)
}

/** Extract the creation time (ms) from an id produced by {@link newId}. */
export function idTime(id: string): number {
  let time = 0
  for (let i = 0; i < 10; i++) {
    const index = ENCODING.indexOf(id[i] ?? '')
    time = time * 32 + (index < 0 ? 0 : index)
  }
  return time
}
