/**
 * The event log.
 *
 * These events are the ONLY thing ever written. State is derived by folding them
 * (see `project.ts`). Because appends are immutable and self-contained, two
 * devices sync by set-union of their logs — there is no merge conflict to resolve.
 */

export type ISODate = string

/** The six kinds of blip Matuschak names, plus a fallback. */
export type BlipType =
  | 'question'
  | 'reference'
  | 'insight'
  | 'idea'
  | 'quest'
  | 'yearning'
  | 'other'

export const BLIP_TYPES: readonly BlipType[] = [
  'question',
  'reference',
  'insight',
  'idea',
  'quest',
  'yearning',
  'other',
]

/** Raw capture payload, before it becomes a blip. */
export interface CaptureInput {
  kind: 'text' | 'url' | 'image'
  text?: string
  url?: string
  /** Content hash of a stored blob (see MediaStore). */
  mediaId?: string
  mime?: string
  filename?: string
}

/** Where a blip came from — the raw material for contextual resurfacing. */
export interface BlipContext {
  source?: 'url' | 'book' | 'person' | 'place' | 'conversation'
  ref?: string
  text?: string
}

export type EntryKind = 'utterance' | 'note' | 'link' | 'summary' | 'example' | 'media'

/**
 * What surrounded an entry when it was written.
 *
 * A move is a prompt, and the prompt is part of the answer: "the 50% rule matters"
 * means something different if the move was "read one paragraph and keep one sentence"
 * than if it was "list three examples".
 *
 * The guidance and the material are stored here rather than looked up later because
 * nothing else in the log has them — they were fetched and shown once, and thrown away.
 * The move itself is not duplicated: the entry already carries `moveId`, and the move
 * history is the one place a move spec lives.
 */
export interface EntryContext {
  /** What the move turned up to read, if it turned up anything. */
  material?: { title: string; url: string; extract: string }
  /** What "help me with the next step" suggested, if it was asked. */
  guidance?: string[]
}

/** Something you added to a blip: the accumulating progress. */
export interface Entry {
  id: string
  kind: EntryKind
  text?: string
  url?: string
  mediaId?: string
  at: ISODate
  /**
   * The move that prompted this, copied onto the entry by the fold from the event that
   * carries it. Without the copy the link is lost the moment the log is projected, and
   * an entry can never be traced back to what asked for it.
   */
  moveId?: string
  /** The move from a friend this entry answers, by the message it arrived in. */
  fromMessageId?: string
  /** Present when a move prompted this entry, and there was something to record. */
  context?: EntryContext
}

/** How much of a fetched extract is worth keeping in the log. */
export const CONTEXT_EXTRACT_LIMIT = 600

/**
 * Trim an entry's context to something worth storing.
 *
 * Returns undefined when there is nothing to say, so an entry written from a move with
 * no material and no advice does not carry an empty object around forever.
 */
export function entryContext(input: {
  material?: { title: string; url: string; extract: string } | null
  guidance?: string[] | null
}): EntryContext | undefined {
  const context: EntryContext = {}

  const material = input.material
  if (material?.title || material?.url) {
    const extract = (material.extract ?? '').trim()
    context.material = {
      title: material.title ?? '',
      url: material.url ?? '',
      extract:
        extract.length > CONTEXT_EXTRACT_LIMIT
          ? `${extract.slice(0, CONTEXT_EXTRACT_LIMIT - 1).trimEnd()}…`
          : extract,
    }
  }

  const guidance = (input.guidance ?? [])
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
  if (guidance.length > 0) context.guidance = guidance

  return Object.keys(context).length > 0 ? context : undefined
}

/** Whether an entry has anything to expand into. */
export function hasContext(entry: Entry): boolean {
  return Boolean(entry.context?.material || entry.context?.guidance?.length)
}

export type BlockKind = 'checklist' | 'grid' | 'readingProgress' | 'poll'

export interface BlockItem {
  id: string
  text?: string
  mediaId?: string
  /** Carried with the item so a block's image syncs with the mime it was stored as. */
  mime?: string
  done?: boolean
  votes?: number
}

/**
 * Malleable structure. A blip that starts as a question may become a grid of
 * examples or a reading-progress tracker, so structure lives in blocks rather
 * than in a fixed schema per type.
 */
export interface Block {
  id: string
  kind: BlockKind
  title?: string
  items: BlockItem[]
  /**
   * For `readingProgress` only. A fraction rather than items-with-done, because
   * "page 42 of 120" is not a list of things you tick — it is one number that moves.
   */
  progress?: { current: number; total: number }
}

/**
 * Somewhere to look for this move.
 *
 * Never a URL the model wrote. The model supplies a phrase and the server turns it into
 * one of these — a page it found and checked is about the thing, or a search for the
 * phrase when no single page is the right answer.
 */
export interface MoveLink {
  /** What to show: a page's title for a reference, the phrase itself for a search. */
  label: string
  url: string
  /**
   * `reference` was found and checked. `search` is honest about not knowing: it says
   * "go and look" rather than pretending a page is the answer.
   */
  kind: 'reference' | 'search'
}

/** A scaffolded microtask. The system prompts you; it never does the blip. */
export interface MoveSpec {
  id: string
  title: string
  why: string
  timeLimitSec: number
  goal: string
  steps?: string[]
  successCriteria?: string
  playbook: string
  /**
   * Where the move came from.
   *
   * `friend` is the third source, and the card says so: a move somebody thought of for you
   * is a different thing from one a playbook or a model produced, and saying which is the
   * difference between a suggestion and a gift.
   */
  generatedBy: 'playbook' | 'llm' | 'friend'
  /**
   * Phrases worth looking up for this move, in the order they are worth looking at.
   *
   * Phrases rather than URLs on purpose: the model cannot invent a link that does not
   * exist, and a hallucinated URL is worse than no link because it looks like an answer.
   * The server resolves each one, and the first that lands on a real page also brings
   * back something to read.
   */
  lookUp?: string[]
}

/**
 * What someone was doing when they said the app was wrong.
 *
 * The whole point of collecting feedback is that a complaint without context is a
 * complaint nobody can act on: "the moves are bad" is unanswerable, while "the moves are
 * bad, on a quest about keyboards, when the model was this one, on this build" is a bug
 * report. Everything here is gathered automatically so the person only has to write the
 * sentence they wanted to write.
 *
 * Deliberately not the Inkling's body: the title is enough to recognise it, and a feedback
 * box is not a place to start copying someone's notes into an admin panel.
 */
export interface FeedbackContext {
  /** Which screen they were looking at. */
  screen: string
  /** The Inkling in front of them, when there was one. */
  blip?: { id: string; type: BlipType; title: string; topics: string[]; entries: number }
  /** The move on screen, when there was one. */
  move?: { id: string; title: string; generatedBy: string }
  /** Where the app was pointed, so a report can be reproduced. */
  provider?: string
  model?: string
  /** Both build stamps, so a stale image shows up in the report instead of staying invisible. */
  app: string
  server: string
  /**
   * Coarse device facts: enough to reproduce a layout problem, not enough to identify
   * anyone. The user agent is sent because a whole class of bug is "only on this browser".
   */
  viewport: { width: number; height: number }
  userAgent: string
  /** How much is in the log — the first question about anything. */
  counts: { inklings: number; events: number; today: number }
}

/**
 * Who may be shown an Inkling.
 *
 * `private` is the default for anything the person has not chosen to share, and the choice
 * is per Inkling rather than per account: what you noticed on Tuesday is not the same as
 * what you noticed on Friday, and one setting for both is a setting nobody can answer
 * honestly.
 */
export type Visibility = 'private' | 'friends'

/**
 * A note from or to a friend: encouragement, kudos on a move, or thanks for one.
 *
 * One event rather than four, because they are the same thing in different directions —
 * and the direction is what the card needs to decide whether to show a person a thing
 * somebody said about them, or a thing they said.
 */
export interface FriendNote {
  id: string
  direction: 'in' | 'out'
  kind: 'kudos' | 'thanks'
  /** The other person's username, as it was when the note was written. */
  username: string
  /**
   * Who it was with, once that was known.
   *
   * Usernames are unique, so a name was enough until a screen had to group notes *by*
   * person — and a name is what somebody chose, not what identifies them.
   */
  userId?: string
  /** What the note was about, when it was about a move. */
  moveTitle?: string
  /**
   * The Inkling it was about, by the id of whoever is holding it.
   *
   * A note *event* carries the blip as its own id only when the blip is yours — a thank-you
   * you send about your own Inkling has a fresh event id, because the note is a thing that
   * happened to somebody else as well. Without this, "have I thanked them for this one?" had
   * nothing to match on, and the button kept asking.
   */
  blipId?: string
  text: string
  at: ISODate
}

/**
 * What a friend is shown when asked about an Inkling.
 *
 * Enough to suggest something specific, and no more. The title, what it is, what has been
 * written against it, and what has already been suggested — so a friend's move can build
 * on the last one instead of repeating it. Not the media, not the schedule, not the
 * history: none of that helps anybody think of something to do.
 */
export interface AskContext {
  blipId: string
  type: BlipType
  title: string
  body?: string
  topics: string[]
  /** What has been written against it, oldest first. Capped. */
  entries: string[]
  /** Moves already put in front of them, so a friend does not offer the same one. */
  offered: string[]
  /**
   * The pictures on it, by content hash.
   *
   * Hashes rather than the pictures: a message is a line of JSON in a file, and a photograph
   * is not. The ids are what the friend's app fetches through the route that serves the
   * blobs of somebody you are actually friends with — and only the ones on a shared Inkling.
   */
  mediaIds?: string[]
}

/** Carried by every event, and what makes the total order deterministic. */
export interface EventMeta {
  deviceId: string
  seq: number
  at: ISODate
}

/**
 * Why a suggestion was judged bad.
 *
 * Short, because this is tapped on a phone. Each one points at a different part of the
 * algorithm: the first two are selection problems, the next two are adaptation problems,
 * and the last is phrasing.
 */
export const REJECTION_REASONS = [
  'nothing to do with this',
  'too vague to act on',
  'too big for one sitting',
  'I already know this',
  'not how I would put it',
] as const

export type RejectionReason = (typeof REJECTION_REASONS)[number]

/**
 * Everything the model was working from, kept so a bad suggestion can be understood
 * later rather than merely counted.
 *
 * A rejection on its own says "wrong". The context says wrong *about what*, which is the
 * part that can change anything — and it is the part that is gone by the time anyone
 * looks, because the move history only keeps what was offered, not what it was offered
 * for.
 */
export interface RejectionContext {
  blipType: BlipType
  blipTitle: string
  topics: string[]
  /** How much had accumulated. "Too vague" often means there was too little to go on. */
  entries: number
  /** Move ids already offered for this blip — what the model was told to avoid. */
  alreadyOffered: string[]
  /** Titles of the related Inklings it was shown. */
  related: string[]
}

export type BlipEventBody =
  | {
      t: 'captured'
      id: string
      input: CaptureInput
      type: BlipType
      title?: string
      body?: string
      context?: BlipContext
      mediaIds?: string[]
      topics?: string[]
      /**
       * Written by the app as an example, not by the person.
       *
       * A real event rather than a special case, because what is being demonstrated is
       * what happens *after* you notice something — a demo mode would show a version of
       * the app that does not exist.
       */
      demo?: boolean
      /**
       * Who may see it, decided when it is written.
       *
       * On the capture rather than left to the fold, because the fold does not know the
       * setting and should not: whether new Inklings start shared is a preference, and a
       * preference applied later would silently re-share things written under a different
       * one. Absent means private, which is what every Inkling written before this was.
       */
      visibility?: Visibility
    }
  /**
   * Something written against an Inkling.
   *
   * `fromMessageId` is set when it answers a move a friend sent, and it is what lets a second
   * friend's move be shown after the first has been answered. `moveId` will not do: a friend's
   * move takes its id from its own title, so two people suggesting "photograph the wall" get
   * one id between them and there is no telling which of them was done.
   */
  | { t: 'entry'; id: string; entry: Entry; moveId?: string; fromMessageId?: string }
  | { t: 'blockAdded'; id: string; block: Block }
  | { t: 'blockUpdated'; id: string; blockId: string; patch: Partial<Omit<Block, 'id'>> }
  | { t: 'blockRemoved'; id: string; blockId: string }
  | { t: 'moveShown'; id: string; moveId: string; moveSpec: MoveSpec }
  | { t: 'moveDone'; id: string; moveId: string }
  | { t: 'moveSkipped'; id: string; moveId: string }
  /**
   * This suggestion was bad, not merely unwanted now.
   *
   * A different signal from `moveSkipped`, and the difference is the point: "not this
   * one" means "not at the moment", while this means "this should not have been offered".
   * Only the second is evidence about the algorithm, so it is kept with the context the
   * model was working from.
   */
  | {
      t: 'moveRejected'
      id: string
      moveId: string
      moveSpec: MoveSpec
      /** One of REJECTION_REASONS, when one was tapped. */
      reason?: string
      /** What they typed, in their own words. Not a replacement for the reason. */
      note?: string
      context: RejectionContext
    }
  /** Keep this move for later, rather than losing it when the card moves on. */
  | { t: 'moveSaved'; id: string; moveId: string; moveSpec: MoveSpec }
  | { t: 'moveUnsaved'; id: string; moveId: string }
  /**
   * Forget what has merely been *offered*, keeping what was actually done.
   *
   * The history exists so the same prompt is not put in front of someone twice. When it
   * is wrong — a bug recorded moves nobody saw, or a move was shown and dismissed — the
   * only way to fix it is to forget, and until now there was none, so the Inkling was
   * stuck being offered variations of the same thing forever.
   */
  | { t: 'movesForgotten'; id: string }
  /** Remove something you added. A tombstone, not a rewrite. */
  | { t: 'entryRemoved'; id: string; entryId: string }
  /** Correct the Inkling itself. Only the fields given are changed. */
  | { t: 'edited'; id: string; title?: string; body?: string; type?: BlipType }
  | { t: 'linked'; id: string; otherId: string; reason?: string }
  | { t: 'topicAdded'; id: string; topic: string }
  | { t: 'snoozed'; id: string; until?: ISODate; triggers?: string[] }
  | { t: 'retired'; id: string; reason?: string }
  | { t: 'revived'; id: string }
  | { t: 'deleted'; id: string }
  | { t: 'promoted'; id: string; notePath: string }
  | { t: 'promoteToDesktop'; id: string }
  | { t: 'unpinFromDesktop'; id: string }
  | { t: 'classified'; id: string; type: BlipType }
  /**
   * Something the person wants to say about the app itself.
   *
   * Carries a fresh id rather than a blip's, so it is ignored by the fold and never
   * becomes an Inkling — the log is the right place for it because it is the only thing
   * that syncs and is never rewritten, but it is not about an Inkling.
   */
  | { t: 'feedback'; id: string; text: string; context: FeedbackContext }
  /** Who may see this Inkling. Private unless the person has said otherwise. */
  | { t: 'shared'; id: string; visibility: Visibility }
  /**
   * A move a friend thought of, for this Inkling.
   *
   * The event is what makes it real: the server only carried the message, and this is the
   * recipient deciding to keep it. So it survives the server going away, and it syncs to
   * their other devices like anything else.
   */
  | {
      t: 'friendMove'
      id: string
      messageId: string
      from: string
      fromUsername: string
      moveSpec: MoveSpec
      note?: string
    }
  /**
   * Asking a friend for help, or being asked.
   *
   * One event in both directions, like `friendNote`, because they are the same thing seen
   * from two ends. An ask you *sent* carries your Inkling's id, so it lands on the card as
   * "you asked Sam on Tuesday". An ask you *received* carries a fresh id and is ignored by
   * the fold — the Inkling in question is not yours — and is read back from the log by the
   * screen that answers it. It has to be in the log rather than only in memory, or a
   * question somebody asked you would disappear on the next reload.
   */
  | {
      t: 'friendAsk'
      id: string
      messageId: string
      direction: 'in' | 'out'
      userId: string
      username: string
      /** What they are asking about, when it is their Inkling rather than yours. */
      context?: AskContext
      note?: string
    }
  /**
   * Clearing the announcement for a move a friend sent.
   *
   * A received move is announced, because a person having thought about your Inkling is the
   * point of the social half. Then it can be waved away without touching the move: the Inkling
   * stays, the move stays on it, and the card goes on saying where it came from. What ends is
   * the telling — not the fact.
   */
  | { t: 'friendMoveSeen'; id: string; messageId: string }
  /**
   * The same, for a question somebody asked.
   *
   * Being told about something and having looked at it are different from having dealt with it,
   * and the list has to show which is which: an answer is not owed the moment a question
   * arrives. Marking it seen says "I have read this", and nothing else.
   */
  | { t: 'friendAskSeen'; id: string; messageId: string }
  /**
   * "Not this move" — taken off the card for good.
   *
   * Distinct from putting it down, which is about when, and from clearing the announcement,
   * which is about whether you have been told. This is about the suggestion itself: it stays
   * in the log, it stays in the history with the friend, and it stops being put in front of
   * you.
   */
  | { t: 'friendMoveDismissed'; id: string; messageId: string }
  /** A record of having suggested a move for somebody else's Inkling. */
  | {
      t: 'friendMoveSent'
      id: string
      messageId: string
      to: string
      toUsername: string
      moveSpec: MoveSpec
      /**
       * The Inkling it was for.
       *
       * Carried so an answer can be matched to an ask without depending on how you got
       * there: the same move can be sent from the ask in Notifications or from browsing a
       * friend's Inklings, and only the first of those knows which ask it answers. Without
       * this, answering from the second left the question sitting in the list.
       */
      blipId?: string
      /** The ask it answers, when it answers one rather than being offered unprompted. */
      askId?: string
    }
  /**
   * A note from a friend, or one sent to one.
   *
   * A note you *sent* carries a fresh id, because the Inkling it is about belongs to the
   * person you sent it to — you do not have it, so there is nothing for the fold to attach
   * it to. A note you *received* carries the id of your own Inkling, so it lands on the
   * card where the move it is cheering on was made.
   */
  | { t: 'friendNote'; id: string; note: FriendNote }

export type BlipEvent = BlipEventBody & EventMeta

/**
 * Deterministic total order over events, identical on every device. Ties on
 * timestamp are broken by device id, then by the per-device sequence number.
 */
export function totalOrder(a: BlipEvent, b: BlipEvent): number {
  if (a.at !== b.at) return a.at < b.at ? -1 : 1
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1
  return a.seq - b.seq
}

/** The blip id an event refers to (always present). */
export function eventBlipId(event: BlipEvent): string {
  return event.id
}
