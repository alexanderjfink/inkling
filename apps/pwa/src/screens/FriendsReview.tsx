import {
  type AskContext,
  type Blip,
  type BlipEvent,
  type Friend,
  buildFriendsRound,
  dismissedFriendInklings,
  suggestedFriendInklings,
} from '@inkling/domain'
import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { FriendImage } from '../components/FriendImage'
import { Linkified } from '../components/Linkified'
import { Markdown } from '../components/Markdown'
import { ButtonLabel, Spinner } from '../components/Spinner'
import { Suggest } from '../components/Suggest'
import { useRoundSwipe } from '../state/useRoundSwipe'
import type { SocialState } from '../state/useSocial'

/** A sit, not a scroll. Ten is the user's number, and about ten Inklings of attention. */
const ROUND = 10

/**
 * Other people's Inklings, one card at a time.
 *
 * The same shape as your own review — the card is the scroll container, a flick that starts at
 * the end moves on, the same strips at the top and bottom — because paging is a habit rather than
 * a layout, and a second set of gestures for the same act would read as the app not knowing
 * which screen it is on.
 *
 * What differs is the colour: the card is bordered and washed in the friend's own colour, the
 * same cue they have everywhere else, so it is obvious whose Inkling you are looking at before
 * you read a word of it.
 */
export function FriendsReview({
  social,
  events,
  blips,
  serverUrl,
  onOpenFriends,
  onOpenFriend,
  onOpenMine,
}: {
  social: SocialState
  events: BlipEvent[]
  blips: Blip[]
  serverUrl: string
  onOpenFriends: () => void
  onOpenFriend: (friend: Friend) => void
  onOpenMine: (id: string) => void
}) {
  const [shared, setShared] = useState<Array<Friend & { inklings: AskContext[] }> | null>(null)
  const [index, setIndex] = useState(0)
  const [composing, setComposing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  /** Set for a moment after sending, so the card can say it went. */
  const [sentTo, setSentTo] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void social.reviewInklings().then((list) => {
      if (alive) setShared(list)
    })
    return () => {
      alive = false
    }
    // Once, on purpose: a round is a sit. Refetching on every render would also refetch on every
    // suggestion, and the round's whole point is that it does not move under you.
  }, [])

  const dismissed = useMemo(() => dismissedFriendInklings(events), [events])
  const suggested = useMemo(() => suggestedFriendInklings(events), [events])

  const round = useMemo(() => {
    const shares = (shared ?? []).flatMap((friend) =>
      friend.inklings.map((context) => ({ friendId: friend.userId, context })),
    )
    return buildFriendsRound({
      asks: social.asks.map((ask) => ({
        friendId: ask.userId,
        messageId: ask.messageId,
        context: ask.context,
        at: ask.at,
      })),
      shares,
      dismissed,
      suggested,
      limit: ROUND,
    })
  }, [shared, social.asks, dismissed, suggested])

  const friendById = useMemo(
    () => new Map(social.friends.map((friend) => [friend.userId, friend])),
    [social.friends],
  )
  const mine = useMemo(
    () => blips.filter((blip) => !blip.deleted && blip.status !== 'retired'),
    [blips],
  )

  /** An item leaves the round when it is sent or put aside, so the index has to be kept honest. */
  const at = Math.min(index, Math.max(0, round.length - 1))
  const current = round[at]
  const friend = current ? friendById.get(current.friendId) : undefined
  const ask = current
    ? social.asks.find((entry) => entry.messageId === current.messageId)
    : undefined
  const overlap = current ? overlapFor(current.context, mine) : undefined

  const swipe = useRoundSwipe({
    next: () => {
      setComposing(false)
      setSentTo(null)
      setIndex((value) => Math.min(value + 1, round.length - 1))
    },
    previous: () => {
      setComposing(false)
      setSentTo(null)
      setIndex((value) => Math.max(value - 1, 0))
    },
    hasNext: at < round.length - 1,
    hasPrevious: at > 0,
  })

  const putAside = () => {
    if (!current) return
    setComposing(false)
    void social.dismissInkling(current.friendId, current.context.blipId)
  }

  if (social.off) {
    return (
      <p className="text-sm text-ink-soft">
        Social features are off for this account. They are on by default — Settings → Friends.
      </p>
    )
  }

  if (social.friends.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-soft">
          Nobody to help yet. A friend has to accept before either of you can see what the other has
          shared — that is the only way in.
        </p>
        <button type="button" onClick={onOpenFriends} className="self-start text-xs text-accent">
          Add a friend
        </button>
      </div>
    )
  }

  if (!current || !friend) {
    return (
      <div className="flex flex-col gap-3">
        {shared === null ? (
          <p className="flex items-center gap-2 text-xs text-ink-faint">
            <Spinner className="h-3.5 w-3.5" />
            looking through what they have shared…
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface/50 p-4">
            <p className="text-sm text-ink-soft">
              That is everyone. Nothing your friends have shared needs a move from you right now.
            </p>
            <button
              type="button"
              onClick={onOpenFriends}
              className="self-start text-xs text-accent"
            >
              Look through a friend’s Inklings
            </button>
          </div>
        )}
      </div>
    )
  }

  const colour = friend.color

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-3 flex items-center gap-3">
        <span className="text-xs whitespace-nowrap text-ink-faint">
          {at + 1} of {round.length}
          {round.some((item) => item.kind === 'ask') ? ' · asked first' : ''}
        </span>
        <button type="button" onClick={onOpenFriends} className="quiet ml-auto text-xs underline">
          everyone
        </button>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={swipe.cardRef}
          onWheel={swipe.handlers.onWheel}
          onTouchStart={swipe.handlers.onTouchStart}
          onTouchMove={swipe.handlers.onTouchMove}
          key={`${current.friendId}:${current.context.blipId}`}
          style={{
            ...swipe.slide,
            // Their colour around the whole card, not only the block inside it: whose shelf you
            // are on should be visible before the title is read.
            ...(colour ? { borderColor: colour, borderWidth: '2px', borderStyle: 'solid' } : {}),
          }}
          className={`card ${swipe.arrival} flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-6`}
        >
          {swipe.showPrevious ? (
            <button
              type="button"
              {...swipe.handlers}
              onClick={() => swipe.previous()}
              className={`sticky top-0 z-10 -mt-2 mb-2 w-full touch-none py-1 text-center text-[11px] ${
                swipe.pull === 'down' && swipe.armed
                  ? 'font-semibold text-accent'
                  : 'text-ink-faint'
              }`}
            >
              ▲ the previous Inkling
            </button>
          ) : null}

          {/* Whose it is, in their colour, before anything else: the one cue that says whose
              shelf you are on. */}
          <div className="flex items-center gap-2.5">
            <Avatar
              username={friend.name ?? friend.username}
              userId={friend.userId}
              color={colour}
              hash={friend.avatar}
              size={26}
            />
            <span className="text-sm font-medium" style={colour ? { color: colour } : undefined}>
              {friend.name ?? friend.username}
            </span>
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
              {current.context.type}
            </span>
            <button
              type="button"
              onClick={() => onOpenFriend(friend)}
              className="quiet ml-auto text-xs underline"
            >
              their Inklings
            </button>
          </div>

          {sentTo ? (
            <div className="mt-5 flex flex-col gap-3">
              <p className="text-sm text-ink-soft">
                Sent to {sentTo} — they will see it the next time they open Inklings.
              </p>
              <button
                type="button"
                onClick={() => {
                  setSentTo(null)
                  setIndex((value) => Math.min(value, Math.max(0, round.length - 1)))
                }}
                className="self-start rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-surface"
              >
                Next
              </button>
            </div>
          ) : (
            <>
              {/* What they asked, when they asked. The move subcard's place on your own card, in
                  their colour, because this is the thing that most wants a person. */}
              {current.kind === 'ask' ? (
                <div
                  className="mt-4 rounded-2xl border p-4"
                  style={{
                    borderColor: colour ? `${colour}88` : undefined,
                    background: colour ? `${colour}12` : undefined,
                  }}
                >
                  <p
                    className="text-xs tracking-wide uppercase"
                    style={colour ? { color: colour } : undefined}
                  >
                    {friend.name ?? friend.username} asked you for a move
                  </p>
                  {ask?.note ? (
                    <p className="mt-1 text-sm text-ink-soft">“{ask.note}”</p>
                  ) : (
                    <p className="mt-1 text-sm text-ink-soft">
                      They are stuck on this one and thought you might see something they cannot.
                    </p>
                  )}
                </div>
              ) : null}

              <Markdown
                text={current.context.title}
                className="mt-4 text-xl leading-snug font-semibold"
              />
              {current.context.body ? (
                <Markdown text={current.context.body} className="mt-2 text-sm text-ink-soft" />
              ) : null}
              {current.context.topics.length > 0 ? (
                <p className="mt-2 text-xs text-ink-faint">{current.context.topics.join(' · ')}</p>
              ) : null}

              {(current.context.mediaIds ?? []).length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {(current.context.mediaIds ?? []).map((hash) => (
                    <FriendImage
                      key={hash}
                      serverUrl={serverUrl}
                      userId={friend.userId}
                      hash={hash}
                      className="max-h-64 rounded-xl border border-line object-cover"
                    />
                  ))}
                </div>
              ) : null}

              {/* What they have written about it, numbered the way your own entries are. */}
              {current.context.entries.length > 0 ? (
                <ol className="mt-4 flex flex-col gap-2.5">
                  {current.context.entries.map((written, position) => (
                    <li
                      key={`${position}-${written.slice(0, 12)}`}
                      className="flex items-start gap-2.5"
                    >
                      <span
                        aria-label={`their entry ${position + 1}`}
                        className="mt-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-[10px] font-semibold text-ink-faint"
                      >
                        {position + 1}
                      </span>
                      <span className="min-w-0 flex-1 rounded-xl border border-line bg-surface/50 px-3 py-2.5 text-sm text-ink-soft">
                        <Linkified text={written} />
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}

              {current.context.offered.length > 0 ? (
                <p className="mt-4 text-xs text-ink-faint">
                  already tried: {current.context.offered.slice(-3).join(' · ')}
                </p>
              ) : null}

              {overlap ? (
                <button
                  type="button"
                  onClick={() => onOpenMine(overlap.id)}
                  className="mt-3 block text-left text-xs text-accent"
                >
                  you have one about this too — “{overlap.title}”
                </button>
              ) : null}

              {problem ? <p className="mt-3 text-xs text-warn">{problem}</p> : null}

              {/* The action row, in the place your own card keeps its three-way control. */}
              <div className="mt-5 border-t border-line pt-4">
                {composing ? (
                  <Suggest
                    context={current.context}
                    onCancel={() => setComposing(false)}
                    onSend={async (move, note) => {
                      setBusy(true)
                      setProblem(null)
                      const result = await social.suggest({
                        to: friend,
                        askId: current.messageId ?? '',
                        blipId: current.context.blipId,
                        move,
                        note: note || undefined,
                      })
                      setBusy(false)
                      if (result === null) {
                        setComposing(false)
                        setSentTo(friend.name ?? friend.username)
                      } else {
                        setProblem(result)
                      }
                      return result
                    }}
                  />
                ) : (
                  <div className="flex flex-wrap items-center gap-4">
                    <button
                      type="button"
                      onClick={() => setComposing(true)}
                      disabled={busy}
                      className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-surface disabled:opacity-40"
                    >
                      <ButtonLabel busy={busy}>suggest a move</ButtonLabel>
                    </button>
                    <button type="button" onClick={putAside} className="quiet text-xs underline">
                      not for me
                    </button>
                  </div>
                )}
              </div>
            </>
          )}

          {swipe.showNext ? (
            <button
              type="button"
              {...swipe.handlers}
              onClick={() => swipe.next()}
              className={`sticky bottom-0 z-10 mt-3 -mb-2 w-full touch-none py-1 text-center text-[11px] ${
                swipe.pull === 'up' && swipe.armed ? 'font-semibold text-accent' : 'text-ink-faint'
              }`}
            >
              ▼ the next Inkling
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * One of yours about the same thing, if there is one.
 *
 * Topics rather than embeddings: this is meant to work with no model at all, and a shared word
 * somebody typed is a stronger signal of shared interest than a vector is of shared shape.
 */
function overlapFor(context: AskContext, mine: Blip[]): Blip | undefined {
  const topics = new Set(context.topics)
  if (topics.size === 0) return undefined
  return mine.find((blip) => blip.topics.some((topic) => topics.has(topic)))
}
