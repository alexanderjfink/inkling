import type { Blip, LLMProvider, MoveSpec, SelectMoveOptions } from '@inkling/domain'
import { selectMove } from '@inkling/domain'
import { useEffect, useState } from 'react'

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
): { move: MoveSpec | null; reroll: () => void } {
  const [move, setMove] = useState<MoveSpec | null>(null)
  const [avoid, setAvoid] = useState<string[]>([])

  const relatedIds = related.map((other) => other.id).join(',')
  const key = blip ? `${blip.id}:${avoid.join(',')}` : ''

  useEffect(() => {
    if (!blip) {
      setMove(null)
      return
    }
    let cancelled = false
    const seen = [...blip.moves.map((entry) => entry.moveId), ...avoid]
    void requestMove(key, { blip, related, seenMoveIds: seen }, { provider, related }).then(
      (spec) => {
        if (!cancelled) setMove(spec)
      },
    )
    return () => {
      cancelled = true
    }
    // `related` is covered by relatedIds; `avoid` by key.
  }, [key, relatedIds, provider, blip])

  function reroll() {
    if (move) setAvoid((current) => [...current, move.id])
  }

  return { move, reroll }
}
