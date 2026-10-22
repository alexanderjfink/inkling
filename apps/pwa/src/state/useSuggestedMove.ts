import type { Blip, LLMProvider, MoveSpec, SelectMoveOptions } from '@inkling/domain'
import { selectMove } from '@inkling/domain'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * In-flight requests, shared across mounts.
 *
 * React StrictMode mounts effects twice in development. Without this the first
 * run's cleanup cancels its request and the second starts another, so the result is
 * thrown away and the card sits on "choosing a move…" forever.
 */
const pending = new Map<string, Promise<MoveSpec>>()

/**
 * Moves already chosen, by the request that chose them.
 *
 * Without this, coming back to an Inkling asked for a *new* move: the fetch was keyed the
 * same way, but the reply had been recorded as shown by then, so the model was told to avoid
 * what it had just offered and produced something else. Reviewing in a list, that reads as a
 * generation happening on its own every time you reach a card you had already asked about.
 *
 * Keyed on the request, so a re-roll or a rejection — which change the key — still asks for
 * something new. That is what those are for.
 */
const chosen = new Map<string, MoveSpec>()

/**
 * Inklings a move has been asked for, for as long as the app is open.
 *
 * Not component state, because the Review screen unmounts when you go to the list and back —
 * so a card you had asked about opened to the two buttons again, as if you never had. That is
 * the same complaint as a generation happening unbidden, seen from the other side.
 */
const askedFor = new Set<string>()

/**
 * Inklings whose saved move has already been shown this session.
 *
 * "Show what was saved first, then generate" needs a memory of having shown it, or swiping
 * past a move you kept brings it straight back for ever.
 */
const savedSeen = new Set<string>()

function requestMove(
  key: string,
  context: Parameters<typeof selectMove>[0],
  options: SelectMoveOptions,
): Promise<MoveSpec> {
  const remembered = chosen.get(key)
  if (remembered) return Promise.resolve(remembered)

  const existing = pending.get(key)
  if (existing) return existing
  const promise = selectMove(context, options)
    .then((spec) => {
      chosen.set(key, spec)
      return spec
    })
    .finally(() => pending.delete(key))
  pending.set(key, promise)
  return promise
}

/**
 * The move to put in front of you, when you ask for one.
 *
 * **Nothing is generated until somebody asks.** It used to fetch on open, so every Inkling
 * you looked at cost a model call — including the many you were only glancing at, and
 * including every Inkling you had already decided to ask a friend about. Two costs, and only
 * one of them is money: the call takes seconds, and seconds of a spinner on a card you were
 * about to put down is the interface feeling slow for no reason.
 *
 * A move you saved is still shown without asking, because you already asked for it once.
 */
export function useSuggestedMove(
  blip: Blip | undefined,
  related: Blip[],
  provider: LLMProvider,
  /**
   * Bumped when the history itself changes — forgetting the offers, say. Without it the
   * suggestion on screen is the one chosen when everything looked used up, which is
   * exactly the suggestion you just asked to be reconsidered.
   */
  revision = 0,
  /**
   * Whether the model may be asked at all.
   *
   * Off is not "a model that happens to be missing": nothing is requested and nothing spins.
   * A move you saved earlier is still what this reports — it is yours and needs no model — but
   * the card only has somewhere to show it when the slot exists, so turning the model back on
   * brings it back rather than losing it.
   */
  enabled = true,
): {
  move: MoveSpec | null
  loading: boolean
  generate: () => void
  /** Forget the suggestion: somebody is asking a person instead. */
  discard: () => void
  reroll: () => void
  /** The next thing to look at: one you saved first, then something new. */
  nextAiMove: () => void
} {
  const [move, setMove] = useState<MoveSpec | null>(null)
  const [loading, setLoading] = useState(false)
  /**
   * The Inkling we have been asked for a move on. Empty means nobody has asked.
   *
   * Seeded from what has been asked for this session, so coming back to a card remembers.
   */
  const [asked, setAsked] = useState('')
  // Re-rolls are remembered per blip, so moving on does not carry them over.
  const [avoid, setAvoid] = useState<{ blipId: string; ids: string[] }>({ blipId: '', ids: [] })

  const blipId = blip?.id ?? ''
  const avoidIds = avoid.blipId === blipId ? avoid.ids : []
  const relatedIds = related.map((other) => other.id).join(',')
  const savedId = blip?.savedMove?.id ?? ''
  /**
   * Part of the key because a rejection changes what the prompt should say.
   *
   * Keyed on the count rather than bumped by hand: the refetch has to happen *after* the
   * rejection is in the projection, or the new move is chosen by a model that has not
   * been told what was just refused — which is the whole point of refusing it.
   */
  const rejections = blip?.rejections.length ?? 0
  /** Whether this Inkling is one a move has been asked for. */
  const wanted = asked === blipId && blipId !== ''
  const key = blip ? `${blipId}:${avoidIds.join(',')}:${revision}:${rejections}` : ''

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

    // A move you saved deliberately is the one to show — no need to ask again, and no need
    // to have been asked either. Once, though: after that it is a move you have seen.
    if (target.savedMove && !savedSeen.has(target.id)) {
      setMove(target.savedMove)
      setLoading(false)
      return
    }

    // Nobody has asked. This is the whole point: opening a card costs nothing.
    if (!wanted || !enabled) {
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
    // `related` is covered by relatedIds; `avoidIds` and `wanted` by key; the blip by blipId.
  }, [key, relatedIds, provider, blipId, savedId, wanted, enabled])

  // Seeded rather than initialised: the blip is not known on the first render, and the
  // answer is remembered across the screen being torn down and rebuilt.
  useEffect(() => {
    if (blipId && askedFor.has(blipId)) setAsked(blipId)
  }, [blipId])

  const generate = useCallback(() => {
    askedFor.add(blipId)
    setAsked(blipId)
  }, [blipId])
  /**
   * Put the card back to the two buttons.
   *
   * Asking a friend is the other way of getting a move, so the suggestion the app made is no
   * longer the thing being answered — leaving it on screen underneath the composer would be
   * offering two answers to one question.
   */
  const discard = useCallback(() => {
    askedFor.delete(blipId)
    setAsked('')
    setMove(null)
  }, [blipId])

  function reroll() {
    if (!move) return
    setAvoid({ blipId, ids: [...avoidIds, move.id] })
  }

  /**
   * The next move from the app.
   *
   * Nothing on screen yet? Show it — which is the saved one, if there is one. Already looking
   * at the saved one? It has been seen, so a new one is asked for. Otherwise: another.
   */
  const nextAiMove = useCallback(() => {
    const target = latest.current
    if (!target) return
    const lookingAtSaved = Boolean(target.savedMove && move && target.savedMove.id === move.id)
    if (lookingAtSaved && target.savedMove) {
      savedSeen.add(target.id)
      setAvoid({ blipId: target.id, ids: [...avoidIds, target.savedMove.id] })
      // And ask for one. Marking it seen without generating left the card empty for ever, which
      // is what "swiping to generate new suggestions seems to not load sometimes" turned out to be.
      askedFor.add(target.id)
      setAsked(target.id)
      return
    }
    if (!move) generate()
    else reroll()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the same refs the effect reads
  }, [move, blipId, avoidIds, generate])

  return { move, loading, generate, discard, reroll, nextAiMove }
}
