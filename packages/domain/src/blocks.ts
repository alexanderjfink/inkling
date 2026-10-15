import type { Block, BlockItem, BlockKind } from './events'

/**
 * Malleable structure, in one place.
 *
 * A blip that starts as a question may turn into a checklist, a reading tracker or a
 * poll. Rather than a fixed schema per blip type, structure lives in blocks that can
 * be added, changed and removed — so the shape can follow what the blip becomes
 * instead of the other way round.
 *
 * The fold stores blocks opaquely; every operation on them is here, so the same
 * rules apply wherever they are edited.
 */

export interface BlockKindInfo {
  kind: BlockKind
  label: string
  /** What it is for, in the words of someone who would actually add it. */
  hint: string
  /** The word for one row, so the UI can say "add a chapter" rather than "add item". */
  itemNoun: string
}

export const BLOCK_KINDS: BlockKindInfo[] = [
  {
    kind: 'checklist',
    label: 'Checklist',
    hint: 'Break it into parts and tick them off',
    itemNoun: 'step',
  },
  {
    kind: 'readingProgress',
    label: 'Reading progress',
    hint: 'How far through this you are',
    itemNoun: 'section',
  },
  {
    kind: 'poll',
    label: 'Poll',
    hint: 'Options you are choosing between',
    itemNoun: 'option',
  },
  {
    kind: 'grid',
    label: 'Grid',
    hint: 'Images side by side — variations, examples',
    itemNoun: 'image',
  },
]

export function blockKindInfo(kind: BlockKind): BlockKindInfo | undefined {
  return BLOCK_KINDS.find((info) => info.kind === kind)
}

function id(): string {
  return crypto.randomUUID()
}

export function newItem(text?: string): BlockItem {
  return text === undefined ? { id: id() } : { id: id(), text }
}

export function newBlock(kind: BlockKind, title?: string): Block {
  const base: Block = {
    id: id(),
    kind,
    items: kind === 'readingProgress' ? [] : [newItem()],
  }
  if (title) base.title = title
  // A tracker starts at zero of something, so it has something to move from.
  if (kind === 'readingProgress') base.progress = { current: 0, total: 0 }
  return base
}

/** 0..1, or null when there is nothing to be a fraction of. */
export function progressFraction(block: Block): number | null {
  const total = block.progress?.total ?? 0
  if (total <= 0) return null
  const current = Math.min(Math.max(block.progress?.current ?? 0, 0), total)
  return current / total
}

/** Move a tracker without letting it go below zero or past its total. */
export function withProgress(block: Block, current: number): Block['progress'] {
  const total = block.progress?.total ?? 0
  const max = total > 0 ? total : Math.max(current, 0)
  return { current: Math.min(Math.max(Math.round(current), 0), max), total: max }
}

export function withTotal(block: Block, total: number): Block['progress'] {
  const clean = Math.max(Math.round(total), 0)
  const current = Math.min(Math.max(block.progress?.current ?? 0, 0), clean)
  return { current, total: clean }
}

export function withToggledItem(items: BlockItem[], itemId: string): BlockItem[] {
  return items.map((item) => (item.id === itemId ? { ...item, done: !item.done } : item))
}

export function withVote(items: BlockItem[], itemId: string): BlockItem[] {
  return items.map((item) =>
    item.id === itemId ? { ...item, votes: (item.votes ?? 0) + 1 } : item,
  )
}

/** Append a row, but never let a list of blank rows pile up. */
export function withItemAdded(items: BlockItem[], text?: string): BlockItem[] {
  return [...items, newItem(text)]
}

export function withItemRemoved(items: BlockItem[], itemId: string): BlockItem[] {
  return items.filter((item) => item.id !== itemId)
}

export function withItemText(items: BlockItem[], itemId: string, text: string): BlockItem[] {
  return items.map((item) => (item.id === itemId ? { ...item, text } : item))
}

/** Ticked / total, for a checklist. Null when there is nothing to count. */
export function checklistCounts(block: Block): { done: number; total: number } | null {
  const rows = block.items.filter((item) => (item.text ?? '').trim().length > 0)
  if (rows.length === 0) return null
  return { done: rows.filter((item) => item.done).length, total: rows.length }
}

/** The option with the most votes, or null on a tie or an empty poll. */
export function pollLeader(block: Block): BlockItem | null {
  const rows = block.items.filter((item) => (item.text ?? '').trim().length > 0)
  if (rows.length === 0) return null
  const sorted = [...rows].sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
  const top = sorted[0]
  const next = sorted[1]
  if (!top || (top.votes ?? 0) === 0) return null
  if (next && (next.votes ?? 0) === (top.votes ?? 0)) return null
  return top
}

/** A one-line summary for the collapsed view of a block. */
export function blockSummary(block: Block): string {
  switch (block.kind) {
    case 'checklist': {
      const counts = checklistCounts(block)
      return counts ? `${counts.done} of ${counts.total} done` : 'nothing on it yet'
    }
    case 'readingProgress': {
      const fraction = progressFraction(block)
      if (fraction === null) return 'no length set'
      const { current, total } = block.progress ?? { current: 0, total: 0 }
      return `${current} of ${total} · ${Math.round(fraction * 100)}%`
    }
    case 'poll': {
      const leader = pollLeader(block)
      const votes = block.items.reduce((sum, item) => sum + (item.votes ?? 0), 0)
      if (votes === 0) return 'no votes yet'
      return leader ? `leading: ${leader.text} (${leader.votes})` : `tied on ${votes} votes`
    }
    case 'grid': {
      const filled = block.items.filter((item) => item.mediaId).length
      return filled === 0 ? 'no images yet' : `${filled} image${filled === 1 ? '' : 's'}`
    }
  }
}
