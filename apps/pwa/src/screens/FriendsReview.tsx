import {
  type AskContext,
  type Blip,
  type BlipEvent,
  type Friend,
  buildFriendsRound,
  dismissedFriendInklings,
  friendShareKey,
  suggestedFriendInklings,
} from '@inkling/domain'
import { useEffect, useMemo, useState } from 'react'
import { FriendInkling } from '../components/FriendInkling'
import { Spinner } from '../components/Spinner'
import type { SocialState } from '../state/useSocial'

/** A sit, not a scroll. Ten is the user's number, and it is about ten Inklings of attention. */
const ROUND = 10

/**
 * Other people's Inklings, in the order that makes them worth a look.
 *
 * This is the one screen in the app that is about somebody else's stuff, so it works the way
 * the app works: a finite round, asks first, and an end. A list of friends' Inklings that
 * refills itself as you scroll is a feed, and a feed is the thing this app is not.
 *
 * It is also the answer to "how do friends' Inklings resurface?" — not on their schedule, which
 * is theirs, but when they ask, when they share something new, and when you have not looked at
 * it yet. Nothing of their due dates is shown, here or anywhere.
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
  /** One of your own Inklings, from the "you have one about this too" line. */
  onOpenMine: (id: string) => void
}) {
  const [shared, setShared] = useState<Array<Friend & { inklings: AskContext[] }> | null>(null)
  /** Put aside this visit. The event is what makes it stick; this is what makes it leave now. */
  const [hidden, setHidden] = useState<Set<string>>(new Set())

  useEffect(() => {
    let alive = true
    void social.reviewInklings().then((list) => {
      if (alive) setShared(list)
    })
    return () => {
      alive = false
    }
    // Once, on purpose: a round is a sit. Asking again on every render would also refetch on
    // every suggestion, and the round's whole point is that it does not move under you.
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

  const visible = round.filter(
    (item) => !hidden.has(friendShareKey(item.friendId, item.context.blipId)),
  )
  const asked = visible.filter((item) => item.kind === 'ask').length
  const mine = useMemo(
    () => blips.filter((blip) => !blip.deleted && blip.status !== 'retired'),
    [blips],
  )

  const putAside = (friendId: string, blipId: string) => {
    setHidden((previous) => new Set(previous).add(friendShareKey(friendId, blipId)))
    void social.dismissInkling(friendId, blipId)
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
          Nothing to review yet. A friend has to accept before either of you can see what the other
          has shared — that is the only way in.
        </p>
        <button type="button" onClick={onOpenFriends} className="self-start text-xs text-accent">
          Add a friend
        </button>
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <div className="flex flex-col gap-1">
        <p className="text-sm text-ink-soft">
          {asked > 0
            ? `${asked} ${asked === 1 ? 'friend has' : 'friends have'} asked you for a move.`
            : 'Nobody has asked. These are things your friends have shared.'}
        </p>
        <p className="text-xs text-ink-faint">
          Asks come first. The rest is whatever they have shared and you have not helped with yet —
          one round at a time, so it can be finished.
        </p>
      </div>

      {shared === null && visible.length === 0 ? (
        <p className="flex items-center gap-2 text-xs text-ink-faint">
          <Spinner className="h-3.5 w-3.5" />
          looking through what they have shared…
        </p>
      ) : null}

      {visible.map((item) => {
        const friend = friendById.get(item.friendId)
        if (!friend) return null
        const ask = social.asks.find((entry) => entry.messageId === item.messageId)
        return (
          <FriendInkling
            key={`${item.friendId}:${item.context.blipId}`}
            friend={friend}
            context={item.context}
            serverUrl={serverUrl}
            askNote={item.kind === 'ask' ? (ask?.note ?? '') : undefined}
            askedAt={item.askedAt}
            overlap={overlapFor(item.context, mine)}
            onOpenMine={onOpenMine}
            onSuggest={(move, note) =>
              social.suggest({
                to: friend,
                askId: item.messageId ?? '',
                blipId: item.context.blipId,
                move,
                note: note || undefined,
              })
            }
            onDismiss={() => putAside(item.friendId, item.context.blipId)}
            onOpenFriend={() => onOpenFriend(friend)}
          />
        )
      })}

      {visible.length === 0 && shared !== null ? (
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface/50 p-4">
          <p className="text-sm text-ink-soft">
            That is everyone. Nothing your friends have shared needs a move from you right now.
          </p>
          <button type="button" onClick={onOpenFriends} className="self-start text-xs text-accent">
            Look through a friend’s Inklings
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onOpenFriends}
          className="self-start text-xs text-ink-faint underline"
        >
          that is the round — look through a friend’s Inklings
        </button>
      )}
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
