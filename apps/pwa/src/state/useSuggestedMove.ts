import type { Blip, LLMProvider, MoveSpec, SelectMoveOptions } from '@inkling/domain'
import { selectMove } from '@inkling/domain'
import { useEffect, useRef, useState } from 'react'

/**
 * In-flight requests, shared across mounts.
 *
 * React StrictMode mounts effects twice in development. Without this the first
 * run's cleanup cancels its request and the second starts another, so the result is
 * thrown away and the card sits on "choosing a move…" forever.
 */
const pending = new Map<string, Promise<MoveSpec>>()

function requestMove(
  key: string,
  context: Parameters<typeof selectMove>[0],
  options: SelectMoveOptions,
): Promise<MoveSpec> {
  const existing = pending.get(key)
  if (existing) return existing
  const promise = selectMove(context, options).finally(() => pending.delete(key))
  pending.set(key, promise)
  return promise
}

/** The move to put in front of you for this blip, re-rolled on request. */
export function useSuggestedMove(
  blip: Blip | undefined,
  related: Blip[],
  provider: LLMProvider,
): { move: MoveSpec | null; loading: boolean; reroll: () => void } {
  const [move, setMove] = useState<MoveSpec | null>(null)
  const [loading, setLoading] = useState(false)
  // Re-rolls are remembered per blip, so moving on does not carry them over.
  const [avoid, setAvoid] = useState<{ blipId: string; ids: string[] }>({ blipId: '', ids: [] })

  const blipId = blip?.id ?? ''
  const avoidIds = avoid.blipId === blipId ? avoid.ids : []
  const relatedIds = related.map((other) => other.id).join(',')
  const key = blip ? `${blipId}:${avoidIds.join(',')}` : ''

  /**
   * The blip, without depending on its identity.
   *
   * Any event write — including recording that a move was shown — produces a new
   * blip object. Depending on it would refetch the move on every write, and since
   * showing a move writes one, that is a loop: fetch, record, refetch, forever.
   * The fetch is keyed on the blip's id and its re-rolls, and reads the rest here.
   */
  const latest = useRef(blip)
  latest.current = blip

  // A move fetched for a different blip is wrong, not merely stale, so it goes. A
  // re-roll keeps the current one on screen instead, because watching it sit there
  // unchanged is what made "not this one" look broken.
  const lastBlip = useRef('')
  useEffect(() => {
    if (lastBlip.current === blipId) return
    lastBlip.current = blipId
    setMove(null)
  }, [blipId])

  useEffect(() => {
    const target = latest.current
    if (!target || target.id !== blipId) {
      setMove(null)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)
    const seen = [...target.moves.map((entry) => entry.moveId), ...avoidIds]
    void requestMove(key, { blip: target, related, seenMoveIds: seen }, { provider, related }).then(
      (spec) => {
        if (cancelled) return
        setMove(spec)
        setLoading(false)
      },
    )
    return () => {
      cancelled = true
    }
    // `related` is covered by relatedIds; `avoidIds` by key; the blip by blipId.
  }, [key, relatedIds, provider, blipId])

  function reroll() {
    if (!move) return
    setAvoid({ blipId, ids: [...avoidIds, move.id] })
  }

  return { move, loading, reroll }
}
