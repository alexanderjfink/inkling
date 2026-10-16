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
   * A search phrase worth looking up for this move.
   *
   * A phrase rather than a URL on purpose: the model cannot invent a link that does
   * not exist, and the server resolves this against a real source.
   */
  materialQuery?: string
}

/** Carried by every event, and what makes the total order deterministic. */
export interface EventMeta {
  deviceId: string
  seq: number
  at: ISODate
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
    }
  | { t: 'entry'; id: string; entry: Entry; moveId?: string }
  | { t: 'blockAdded'; id: string; block: Block }
  | { t: 'blockUpdated'; id: string; blockId: string; patch: Partial<Omit<Block, 'id'>> }
  | { t: 'blockRemoved'; id: string; blockId: string }
  | { t: 'moveShown'; id: string; moveId: string; moveSpec: MoveSpec }
  | { t: 'moveDone'; id: string; moveId: string }
  | { t: 'moveSkipped'; id: string; moveId: string }
  /** Keep this move for later, rather than losing it when the card moves on. */
  | { t: 'moveSaved'; id: string; moveId: string; moveSpec: MoveSpec }
  | { t: 'moveUnsaved'; id: string; moveId: string }
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
