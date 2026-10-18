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
  return value === 'ask' || value === 'move' || value === 'kudos' || value === 'thanks'
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
    // A few, in the order they were added: enough to show what they are looking at without
    // turning a message into a gallery.
    mediaIds: blip.entries
      .map((entry) => entry.mediaId)
      .filter((id): id is string => typeof id === 'string')
      .slice(0, ASK_MEDIA_MAX),
  }
}
