import type { Blip, LLMProvider, RelatedBlip } from '@inkling/domain'
import { topRelated } from '@inkling/domain'
import { useEffect, useMemo, useState } from 'react'
import { loadEmbeddings } from '../embeddings'

/**
 * Related blips for every blip, best first.
 *
 * Embeddings are loaded only when the provider actually has them, and are cached by
 * content hash. Everything still works without them — topics, links and wording
 * carry the relation — which matters because OpenCode Go and Anthropic offer none.
 */
export function useRelated(
  blips: Blip[],
  provider: LLMProvider,
  useEmbeddings: boolean,
  similarityFloor?: number | null,
): Map<string, RelatedBlip[]> {
  const [embeddings, setEmbeddings] = useState<Map<string, number[]>>(new Map())

  useEffect(() => {
    if (!useEmbeddings || blips.length === 0) return
    let cancelled = false
    void loadEmbeddings(blips, provider).then((vectors) => {
      if (!cancelled) setEmbeddings(vectors)
    })
    return () => {
      cancelled = true
    }
  }, [blips, provider, useEmbeddings])

  return useMemo(() => {
    const map = new Map<string, RelatedBlip[]>()
    for (const blip of blips) {
      map.set(
        blip.id,
        topRelated(blip, blips, {
          embeddings,
          limit: 3,
          similarityFloor: similarityFloor ?? undefined,
        }),
      )
    }
    return map
  }, [blips, embeddings, similarityFloor])
}
