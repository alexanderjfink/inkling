import type { AskContext, ISODate, MoveSpec } from './events'
import type { Blip } from './project'

/**
 * Help from a person rather than from a model.
 *
 * The whole of this file is the vocabulary of one idea: a move can come from a friend.
 * Everything else — friends, notifications, kudos — exists to make that possible or to
 * make it worth doing, and the shape here is deliberately small so that stays true.
 */

/** Whether new Inklings start shared, when social features are on. */
export type ShareDefault = 'friends' | 'private'

export type FriendStatus = 'accepted' | 'asked' | 'asked-of-you'

/**
 * A friendship, from one side.
 *
 * Symmetric once accepted, so it is stored as a pair and read from whichever end you are.
 * A request has to be accepted rather than assumed: typing somebody's username must not
 * be enough to be shown what they have been noticing.
 */
export interface Friend {
  userId: string
  username: string
  /** What they would like to be called, when it is not their username. */
  name?: string
  status: FriendStatus
  at: ISODate
  /** How they appear, so a friend's move is recognisably theirs at a glance. */
  color?: string
  avatar?: string
}

/**
 * A message between two accounts.
 *
 * The server carries these and does not interpret them; the recipient turns each into an
 * event in their own log, which is where it becomes real. So a message that arrives twice
 * is harmless, and a message that never arrives is a missing event rather than a missing
 * truth — the same bargain the rest of the app makes.
 */
export type SocialMessage =
  | {
      id: string
      kind: 'ask'
      from: string
      fromUsername: string
      to: string
      at: ISODate
      context: AskContext
      /** Whatever they wanted to say about being stuck. */
      note?: string
    }
  | {
      id: string
      kind: 'move'
      from: string
      fromUsername: string
      to: string
      at: ISODate
      /** The ask this answers, so the asker can be shown it was answered. */
      askId: string
      /**
       * The Inkling it is for, as the asker knows it.
       *
       * Carried rather than looked up from the ask: the person receiving it is the one who
       * has to attach it to an Inkling, and making them search their own history for what
       * they once asked about is a lookup that can fail for no good reason.
       */
      blipId: string
      move: MoveSpec
      note?: string
    }
  | {
      id: string
      kind: 'kudos'
      from: string
      fromUsername: string
      to: string
      at: ISODate
      /** The Inkling it is about, as the person who has it knows it. */
      blipId: string
      /** The move being cheered on, by title, so the note makes sense on its own. */
      moveTitle: string
      text: string
    }
  | {
      id: string
      kind: 'used'
      from: string
      fromUsername: string
      to: string
      at: ISODate
      /** The Inkling it was on, as the person who has it knows it. */
      blipId: string
      /** The move, by title, because the suggester's log keys it by nothing else. */
      moveTitle: string
      /** "This was the right one", when they said so. */
      fit?: boolean
    }
  | {
      id: string
      kind: 'thanks'
      from: string
      fromUsername: string
      to: string
      at: ISODate
      blipId: string
      text: string
    }

export type SocialMessageKind = SocialMessage['kind']

/** How long a note may be. Long enough to say something, short enough to be a note. */
export const NOTE_MAX = 280

/** How much of an Inkling's written history a friend is shown. */
export const ASK_ENTRIES_MAX = 6
/** How many pictures of theirs a friend is shown. Enough to see, not a gallery. */
export const ASK_MEDIA_MAX = 4

/** The longest a friend's suggested move may be, matching the playbook's own ceiling. */
export const FRIEND_MOVE_MAX_SEC = 900

export function isSocialMessageKind(value: unknown): value is SocialMessageKind {
  return (
    value === 'ask' ||
    value === 'move' ||
    value === 'kudos' ||
    value === 'thanks' ||
    value === 'used'
  )
}

/**
 * The friends review: other people's Inklings, in the order that makes them worth a look.
 *
 * Two sources, and they are not equal. An **ask** is somebody saying they are stuck — it goes
 * first, oldest first, and the round never drops one to make room. A **share** is something they
 * chose to be visible: still worth a look, and the reason this is not only a queue of pleas.
 *
 * The round is finite on purpose. Everything else in the app is a sit you can finish, and a list
 * of other people's Inklings that refills itself is a feed. So a share leaves the round when you
 * have suggested something for it or waved it away, and one friend's shelf cannot fill it.
 */
export interface FriendShare {
  friendId: string
  context: AskContext
}

export interface FriendAsk {
  friendId: string
  messageId: string
  context: AskContext
  at: ISODate
}

export interface FriendsRoundItem {
  kind: 'ask' | 'inkling'
  friendId: string
  context: AskContext
  /** Set for an ask: the message, so answering can name it. */
  messageId?: string
  /** When they asked. Orders the asks, and says how long somebody has been waiting. */
  askedAt?: ISODate
}

/** How the round is identified in the dismissed and suggested sets. */
export function friendShareKey(friendId: string, blipId: string): string {
  return `${friendId}:${blipId}`
}

export function buildFriendsRound({
  asks,
  shares,
  dismissed = new Set<string>(),
  suggested = new Set<string>(),
  limit = 10,
}: {
  asks: FriendAsk[]
  shares: FriendShare[]
  /** Keys from {@link friendShareKey} that you have waved away. */
  dismissed?: Set<string>
  /** Keys you have already suggested a move for. */
  suggested?: Set<string>
  limit?: number
}): FriendsRoundItem[] {
  const round: FriendsRoundItem[] = []
  const taken = new Set<string>()

  const openAsks = asks
    .filter((ask) => !dismissed.has(friendShareKey(ask.friendId, ask.context.blipId)))
    .slice()
    .sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1))

  for (const ask of openAsks) {
    const key = friendShareKey(ask.friendId, ask.context.blipId)
    if (taken.has(key)) continue
    taken.add(key)
    round.push({
      kind: 'ask',
      friendId: ask.friendId,
      context: ask.context,
      messageId: ask.messageId,
      askedAt: ask.at,
    })
  }

  /**
   * One per friend, then the next, rather than one friend's whole shelf.
   *
   * A round that is eight of Sam's Inklings is a round about Sam. Taking a turn each keeps it
   * a round about your friends, and the newest share of each is the one most likely to be what
   * they are working on now.
   */
  const queues = new Map<string, AskContext[]>()
  for (const share of shares) {
    const key = friendShareKey(share.friendId, share.context.blipId)
    if (dismissed.has(key) || suggested.has(key) || taken.has(key)) continue
    const queue = queues.get(share.friendId) ?? []
    if (queue.some((context) => context.blipId === share.context.blipId)) continue
    queue.push(share.context)
    queues.set(share.friendId, queue)
  }

  const newest = (contexts: AskContext[]) =>
    contexts.reduce(
      (at, context) => (context.updated && context.updated > at ? context.updated : at),
      '',
    )

  const order = [...queues.entries()]
    .map(([friendId, contexts]) => ({
      friendId,
      contexts: contexts.slice().sort((a, b) => ((a.updated ?? '') < (b.updated ?? '') ? 1 : -1)),
    }))
    .sort((a, b) => (newest(a.contexts) < newest(b.contexts) ? 1 : -1))

  let added = true
  while (added && round.length < limit) {
    added = false
    for (const friend of order) {
      if (round.length >= limit) break
      const context = friend.contexts.shift()
      if (!context) continue
      added = true
      round.push({ kind: 'inkling', friendId: friend.friendId, context })
    }
  }

  return round
}

/**
 * What a friend would be shown, built from the Inkling itself.
 *
 * In the domain because both ends need the same answer: the asker builds it to send, and
 * the server builds it when a friend looks at what somebody has shared. Two builders
 * would be two chances to disagree about what was shown to whom.
 *
 * Deliberately not the media, the schedule or the move history. None of that helps
 * anybody think of something to do, and a friend being asked for help is not being handed
 * the whole of somebody's notes.
 */
export function askContextFor(blip: Blip): AskContext {
  return {
    blipId: blip.id,
    type: blip.type,
    title: blip.title,
    body: blip.body && blip.body !== blip.title ? blip.body : undefined,
    topics: [...blip.topics],
    entries: blip.entries
      .map((entry) => entry.text ?? entry.url ?? '')
      .filter((text) => text.trim().length > 0)
      .slice(-ASK_ENTRIES_MAX),
    offered: blip.moves.map((move) => move.spec.title).slice(-ASK_ENTRIES_MAX),
    updated: blip.updated,
    // A few, in the order they were added: enough to show what they are looking at without
    // turning a message into a gallery.
    mediaIds: blip.entries
      .map((entry) => entry.mediaId)
      .filter((id): id is string => typeof id === 'string')
      .slice(0, ASK_MEDIA_MAX),
  }
}
