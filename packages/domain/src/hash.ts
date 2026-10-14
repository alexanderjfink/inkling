/**
 * SHA-256 as lowercase hex.
 *
 * Used in two places, which is why it lives here: content-addressing media blobs
 * (so identical bytes dedupe across devices) and verifying log/blob integrity on
 * the server. One implementation means the client and server can never disagree.
 */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh ArrayBuffer: a Uint8Array's backing store may be shared,
  // and the digest API wants an unambiguously-owned buffer.
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', buffer)
  let out = ''
  for (const byte of new Uint8Array(digest)) out += byte.toString(16).padStart(2, '0')
  return out
}
