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

/** Something you added to a blip: the accumulating progress. */
export interface Entry {
  id: string
  kind: EntryKind
  text?: string
  url?: string
  mediaId?: string
  at: ISODate
}

export type BlockKind = 'checklist' | 'grid' | 'readingProgress' | 'poll'

export interface BlockItem {
  id: string
  text?: string
  mediaId?: string
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
  | { t: 'moveShown'; id: string; moveId: string; moveSpec: MoveSpec }
  | { t: 'moveDone'; id: string; moveId: string }
  | { t: 'moveSkipped'; id: string; moveId: string }
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
