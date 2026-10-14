import type { Blip, LLMProvider } from '@inkling/domain'
import { blipText, sha256Hex } from '@inkling/domain'
import { storage } from './state/useInkling'

const CACHE_PREFIX = 'embed:'

/**
 * Embeddings, cached by the *content* of the blip.
 *
 * Keyed by a hash of the text rather than the blip id, so editing a blip
 * re-embeds it and unchanged blips are never re-sent. Vectors live in the same
 * local store as everything else, so they sync with the log's device.
 *
 * All of this is best-effort: a provider without embeddings (OpenCode Go,
 * Anthropic) simply yields an empty map, and relatedness falls back to topics,
 * links and wording.
 */
export async function blipContentHash(blip: Blip): Promise<string> {
  return sha256Hex(new TextEncoder().encode(blipText(blip)))
}

export async function loadEmbeddings(
  blips: Blip[],
  provider: LLMProvider,
): Promise<Map<string, number[]>> {
  const store = storage()
  const vectors = new Map<string, number[]>()
  const missing: Array<{ blip: Blip; hash: string }> = []

  for (const blip of blips) {
    const hash = await blipContentHash(blip)
    const cached = await store.getSetting(`${CACHE_PREFIX}${hash}`)
    if (cached) {
      try {
        vectors.set(blip.id, JSON.parse(cached) as number[])
        continue
      } catch {
        // Corrupt cache entry; fall through and re-embed.
      }
    }
    missing.push({ blip, hash })
  }

  if (missing.length === 0) return vectors

  try {
    const embedded = await provider.embed(missing.map((entry) => blipText(entry.blip)))
    for (let index = 0; index < missing.length; index++) {
      const vector = embedded[index]
      const entry = missing[index]
      if (!vector || !entry || vector.length === 0) continue
      vectors.set(entry.blip.id, vector)
      await store.setSetting(`${CACHE_PREFIX}${entry.hash}`, JSON.stringify(vector))
    }
  } catch {
    // No embeddings available. Topics, links and wording carry relatedness.
  }

  return vectors
}
