import type { BlipEvent, ISODate } from './events'

/**
 * One friend, and everything that has passed between you.
 *
 * Read from the log rather than asked of the server, which is the whole reason it can be
 * complete: every ask, every suggested move and every thank-you is already written down on
 * this device, in both directions. The server only carried the messages; the log is where
 * they became facts, and it is the only place that knows about the ones that never needed a
 * network at all.
 *
 * The direction is the point of it. "You asked them", "they asked you", "you sent them
 * something", "they sent you something" — a list of both is the only honest answer to "what
 * has this friendship been for", and picking a side is a filter on top of it rather than a
 * shape of its own.
 */
export type FriendTimelineKind =
  | 'you-asked'
  | 'they-asked'
  | 'you-sent-move'
  | 'they-sent-move'
  | 'you-thanked'
  | 'they-thanked'
  | 'you-noted'
  | 'they-noted'

export interface FriendTimelineEntry {
  /** Stable within a screen: the event it came from, or the blip when there are several. */
  key: string
  /** Who it was with. Filled in by `buildSocialTimeline`; unnecessary with one friend. */
  userId?: string
  username?: string
  at: ISODate
  /** `out` is help you gave; `in` is help you were given. */
  direction: 'out' | 'in'
  kind: FriendTimelineKind
  /** What it was about: the Inkling, by name where we can name it. */
  title: string
  /** The move, when the entry is a move. */
  moveTitle?: string
  /** The Inkling a thank-you would be about, when thanking makes sense at all. */
  blipId?: string
  /**
   * The message it arrived in, for the things that are answers to something.
   *
   * An ask that came in is answerable, and the answer has to name the ask — which is the
   * message, not the event, since the event id was made on this side when it landed.
   */
  messageId?: string
  /** An ask nobody has answered yet. */
  open?: boolean
  /** Whether a thank-you has already been sent for this one. */
  thanked?: boolean
}

/**
 * A move a friend sent that has not been cleared yet.
 *
 * Enough to say who, what, and about which Inkling — which is all a notification needs, and
 * all it should carry: the move itself lives on the Inkling where it happened.
 */
export interface FriendMoveNotice {
  messageId: string
  from: string
  fromUsername: string
  /** The Inkling it landed on, which is yours. */
  blipId: string
  moveTitle: string
  note?: string
  at: ISODate
}

/**
 * Moves from friends that nobody has waved away, newest first.
 *
 * Read from the log like everything else social: the announcement is a thing that happened,
 * and clearing it is another. Nothing is deleted and nothing is rewritten, so a notification
 * cleared on the phone is cleared on the laptop the moment they sync.
 */
export function unseenFriendMoves(events: BlipEvent[]): FriendMoveNotice[] {
  const cleared = new Set(
    events
      .filter(
        (event): event is Extract<BlipEvent, { t: 'friendMoveSeen' }> =>
          event.t === 'friendMoveSeen',
      )
      .map((event) => event.messageId),
  )

  return events
    .filter((event): event is Extract<BlipEvent, { t: 'friendMove' }> => event.t === 'friendMove')
    .filter((event) => !cleared.has(event.messageId))
    .map((event) => ({
      messageId: event.messageId,
      from: event.from,
      fromUsername: event.fromUsername,
      blipId: event.id,
      moveTitle: event.moveSpec.title,
      note: event.note,
      at: event.at,
    }))
    .sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1))
}

export interface FriendIdentity {
  userId: string
  username: string
}

/**
 * Everything between you and one friend, newest first.
 *
 * `titles` names an Inkling by id. Both sides are in it: your own Inklings from your blips,
 * and theirs from the context they sent with the ask — which is what lets "they asked about
 * the sourdough starter" read as a sentence rather than as an id.
 */
export function buildFriendTimeline(
  events: BlipEvent[],
  friend: FriendIdentity,
  titles: Map<string, string>,
): FriendTimelineEntry[] {
  return buildSocialTimeline(events, titles).filter((entry) => entry.userId === friend.userId)
}

/**
 * Everything that has passed with anyone, newest first.
 *
 * The same entries as a single friend's history, with the person attached — because the
 * question "what has been going on" comes before "what has been going on with Sam", and a
 * list of friends is a menu rather than an answer. Filtering by person is then a filter on
 * this, not a different screen.
 */
export function buildSocialTimeline(
  events: BlipEvent[],
  titles: Map<string, string>,
): FriendTimelineEntry[] {
  const entries: FriendTimelineEntry[] = []

  interface MoveSent extends Extract<BlipEvent, { t: 'friendMoveSent' }> {}
  const movesToThem = (userId: string): MoveSent[] =>
    events.filter((event): event is MoveSent => event.t === 'friendMoveSent' && event.to === userId)

  /** A thank-you already sent about this Inkling, so the button says so rather than asking twice. */
  const thanked = (blipId: string | undefined, userId: string): boolean =>
    Boolean(
      blipId &&
        events.some(
          (event) =>
            event.t === 'friendNote' &&
            event.note.direction === 'out' &&
            event.note.kind === 'thanks' &&
            event.note.userId === userId &&
            (event.note.blipId === blipId || event.id === blipId),
        ),
    )

  /** Whether an ask from them has been answered by anything we sent back. */
  const answered = (userId: string, askId: string, blipId: string | undefined): boolean =>
    movesToThem(userId).some(
      (move) =>
        (move.askId && move.askId === askId) || (Boolean(move.blipId) && move.blipId === blipId),
    )

  for (const event of events) {
    if (event.t === 'friendAsk') {
      const blipId = event.direction === 'out' ? event.id : event.context?.blipId
      entries.push({
        key: `${event.id}:${event.at}`,
        at: event.at,
        userId: event.userId,
        username: event.username,
        messageId: event.messageId,
        direction: event.direction === 'out' ? 'out' : 'in',
        kind: event.direction === 'out' ? 'you-asked' : 'they-asked',
        title: titles.get(blipId ?? '') ?? event.context?.title ?? 'an Inkling',
        blipId,
        // An ask you sent is open until something came back; one they sent is open until
        // something went back.
        open:
          event.direction === 'out'
            ? !events.some(
                (other) =>
                  other.t === 'friendMove' && other.from === event.userId && other.id === event.id,
              )
            : !answered(event.userId, event.messageId, blipId),
      })
      continue
    }

    if (event.t === 'friendMove') {
      entries.push({
        key: event.messageId,
        at: event.at,
        userId: event.from,
        username: event.fromUsername,
        messageId: event.messageId,
        direction: 'in',
        kind: 'they-sent-move',
        title: titles.get(event.id) ?? 'an Inkling',
        moveTitle: event.moveSpec.title,
        blipId: event.id,
        thanked: thanked(event.id, event.from),
      })
      continue
    }

    if (event.t === 'friendMoveSent') {
      entries.push({
        key: event.messageId,
        at: event.at,
        userId: event.to,
        username: event.toUsername,
        direction: 'out',
        kind: 'you-sent-move',
        title:
          (event.blipId ? titles.get(event.blipId) : undefined) ??
          (event.askId ? titles.get(event.askId) : undefined) ??
          'their Inkling',
        moveTitle: event.moveSpec.title,
        blipId: event.blipId,
      })
      continue
    }

    if (event.t === 'friendNote') {
      const mine = event.note.direction === 'out'
      const thanks = event.note.kind === 'thanks'
      entries.push({
        key: `${event.id}:${event.at}`,
        at: event.at,
        userId: event.note.userId,
        username: event.note.username,
        direction: mine ? 'out' : 'in',
        kind: thanks ? (mine ? 'you-thanked' : 'they-thanked') : mine ? 'you-noted' : 'they-noted',
        title: event.note.moveTitle ?? titles.get(event.id) ?? 'an Inkling',
        blipId: event.id,
      })
    }
  }

  return entries.sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? 1 : -1))
}

/**
 * The messages that have been looked at, whichever kind they were.
 *
 * Read from the log like everything else. "Seen" and "dealt with" are kept apart on purpose:
 * a question can be read without being answered, and the list needs to be able to say so.
 */
export function seenNoticeIds(events: BlipEvent[]): Set<string> {
  const seen = new Set<string>()
  for (const event of events) {
    if (event.t === 'friendMoveSeen' || event.t === 'friendAskSeen') seen.add(event.messageId)
  }
  return seen
}

/** How many thank-yous this account has been sent. The reward for helping people. */
export function thanksReceivedNote(events: BlipEvent[]): number {
  return events.filter(
    (event) =>
      event.t === 'friendNote' && event.note.direction === 'in' && event.note.kind === 'thanks',
  ).length
}

/** Whether this account has thanked that Inkling already, so the button can say so. */
export function hasThanked(
  events: BlipEvent[],
  friend: FriendIdentity,
  blipId: string | undefined,
): boolean {
  if (!blipId) return false
  return events.some(
    (event) =>
      event.t === 'friendNote' &&
      event.note.direction === 'out' &&
      event.note.kind === 'thanks' &&
      event.note.userId === friend.userId &&
      (event.note.blipId === blipId || event.id === blipId),
  )
}
