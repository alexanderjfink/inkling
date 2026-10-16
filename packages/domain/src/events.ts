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
  generatedBy: 'playbook' | 'llm'
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
    }
  | { t: 'entry'; id: string; entry: Entry; moveId?: string }
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
