import { existsSync, readFileSync } from 'node:fs'

/**
 * Which build this server is.
 *
 * The image writes a stamp beside the code, from a hash of the source it was built from.
 * `/api/health` reports it so the app can put its own stamp next to the server's and say
 * when the two have drifted apart — which is what a stale image looks like from the
 * inside, and it used to look like nothing at all.
 */
function readStamp(): string {
  const fromEnv = process.env.INKLING_BUILD?.trim()
  if (fromEnv) return fromEnv

  try {
    const path = new URL('../../.build-stamp', import.meta.url).pathname
    if (existsSync(path)) return readFileSync(path, 'utf8').trim() || 'dev'
  } catch {
    // No stamp: a local checkout, or `bun run server` outside an image.
  }

  return 'dev'
}

export const BUILD = readStamp()
