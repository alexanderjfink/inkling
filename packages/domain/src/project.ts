import type {
  BlipContext,
  BlipEvent,
  BlipType,
  Block,
  CaptureInput,
  Entry,
  MoveSpec,
} from './events'
import { totalOrder } from './events'

/** Scheduling state for a single blip. A `nextEarliest` is a *floor*, never a due date. */
export interface ScheduleState {
  nextEarliest?: string
  triggers: string[]
  heat: number
  lastTouched?: string
  timesShown: number
  timesEngaged: number
  timesSkipped: number
}

export interface MoveHistoryEntry {
  moveId: string
  spec: MoveSpec
  shownAt: string
  outcome: 'shown' | 'done' | 'skipped'
  /** When it was completed, if it was. */
  doneAt?: string
}

export type BlipStatus = 'active' | 'snoozed' | 'retired' | 'promoted'

/** The folded, read-only projection of a blip. Never written directly. */
export interface Blip {
  id: string
  created: string
  updated: string
  status: BlipStatus
  deleted: boolean
  type: BlipType
  title: string
  body: string
  input?: CaptureInput
  context?: BlipContext
  topics: string[]
  links: string[]
  entries: Entry[]
  blocks: Block[]
  schedule: ScheduleState
  moves: MoveHistoryEntry[]
  /** A move kept deliberately, offered again next time this surfaces. */
  savedMove?: MoveSpec
  export?: { notePath: string; at: string }
  desktopPinned: boolean
}

const INITIAL_HEAT = 0.4

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n))
}

function deriveTitle(id: string, title?: string, body?: string, input?: CaptureInput): string {
  if (title?.trim()) return title.trim()
  if (body?.trim()) {
    const firstLine = body.trim().split('\n')[0] ?? ''
    if (firstLine.trim()) return firstLine.trim().slice(0, 120)
  }
  if (input?.kind === 'url' && input.url) {
    try {
      return new URL(input.url).hostname.replace(/^www\./, '')
    } catch {
      return input.url
    }
  }
  if (input?.kind === 'image') return input.filename ?? 'Image'
  return id.slice(0, 8)
}

function applyEvent(blips: Map<string, Blip>, event: BlipEvent): void {
  if (event.t === 'captured') {
    const blip: Blip = {
      id: event.id,
      created: event.at,
      updated: event.at,
      status: 'active',
      deleted: false,
      type: event.type,
      title: deriveTitle(event.id, event.title, event.body ?? event.input.text, event.input),
      body: event.body ?? event.input.text ?? '',
      input: event.input,
      context: event.context,
      topics: [...(event.topics ?? [])],
      links: [],
      entries: [],
      blocks: [],
      schedule: {
        triggers: [],
        heat: INITIAL_HEAT,
        lastTouched: undefined,
        timesShown: 0,
        timesEngaged: 0,
        timesSkipped: 0,
      },
      moves: [],
      desktopPinned: false,
    }
    if (event.mediaIds?.length) {
      for (const mediaId of event.mediaIds) {
        blip.entries.push({
          id: `${event.id}:media:${mediaId}`,
          kind: 'media',
          mediaId,
          at: event.at,
        })
      }
    }
    blips.set(event.id, blip)
    return
  }

  const blip = blips.get(event.id)
  if (!blip) return
  blip.updated = event.at

  switch (event.t) {
    case 'entry':
      blip.entries.push(event.entry)
      blip.schedule.lastTouched = event.at
      blip.schedule.heat = clamp01(blip.schedule.heat + 0.1)
      blip.schedule.timesEngaged += 1
      break
    case 'blockAdded':
      blip.blocks.push(event.block)
      break
    case 'blockUpdated': {
      const block = blip.blocks.find((b) => b.id === event.blockId)
      if (block) Object.assign(block, event.patch)
      break
    }
    case 'moveShown':
      blip.moves.push({
        moveId: event.moveId,
        spec: event.moveSpec,
        shownAt: event.at,
        outcome: 'shown',
      })
      blip.schedule.timesShown += 1
      break
    case 'moveDone': {
      const move = blip.moves.find((m) => m.moveId === event.moveId)
      if (move) {
        move.outcome = 'done'
        move.doneAt = event.at
      }
      // A saved move has been used, so it is no longer waiting.
      if (blip.savedMove?.id === event.moveId) blip.savedMove = undefined
      blip.schedule.heat = clamp01(blip.schedule.heat + 0.15)
      blip.schedule.timesEngaged += 1
      blip.schedule.lastTouched = event.at
      break
    }
    case 'moveSaved':
      blip.savedMove = event.moveSpec
      break
    case 'moveUnsaved':
      if (blip.savedMove?.id === event.moveId) blip.savedMove = undefined
      break
    case 'entryRemoved':
      blip.entries = blip.entries.filter((entry) => entry.id !== event.entryId)
      break
    case 'edited':
      if (event.title !== undefined) blip.title = event.title
      if (event.body !== undefined) blip.body = event.body
      if (event.type !== undefined) blip.type = event.type
      break
    case 'moveSkipped': {
      const move = blip.moves.find((m) => m.moveId === event.moveId)
      if (move) move.outcome = 'skipped'
      blip.schedule.heat = clamp01(blip.schedule.heat - 0.1)
      blip.schedule.timesSkipped += 1
      break
    }
    case 'linked':
      if (!blip.links.includes(event.otherId)) blip.links.push(event.otherId)
      break
    case 'topicAdded':
      if (!blip.topics.includes(event.topic)) blip.topics.push(event.topic)
      break
    case 'snoozed':
      blip.status = 'snoozed'
      blip.schedule.nextEarliest = event.until
      if (event.triggers?.length) {
        blip.schedule.triggers = [...new Set([...blip.schedule.triggers, ...event.triggers])]
      }
      blip.schedule.lastTouched = event.at
      break
    case 'retired':
      blip.status = 'retired'
      blip.schedule.lastTouched = event.at
      break
    case 'revived':
      blip.status = 'active'
      blip.schedule.nextEarliest = undefined
      blip.schedule.triggers = []
      blip.schedule.lastTouched = event.at
      break
    case 'deleted':
      blip.deleted = true
      break
    case 'promoted':
      blip.status = 'promoted'
      blip.export = { notePath: event.notePath, at: event.at }
      break
    case 'promoteToDesktop':
      blip.desktopPinned = true
      break
    case 'unpinFromDesktop':
      blip.desktopPinned = false
      break
    case 'classified':
      blip.type = event.type
      break
  }
}

/**
 * Fold the event log into blips. Input order does not matter: events are sorted
 * by the deterministic total order first, so every device folds to the same state.
 */
export function project(events: BlipEvent[]): Blip[] {
  const sorted = [...events].sort(totalOrder)
  const map = new Map<string, Blip>()
  for (const event of sorted) applyEvent(map, event)

  // Make `linked` symmetric after every blip exists, so forward references work.
  for (const blip of map.values()) {
    for (const otherId of blip.links) {
      const target = map.get(otherId)
      if (target && !target.links.includes(blip.id)) target.links.push(blip.id)
    }
  }

  return [...map.values()].sort((a, b) => (a.created < b.created ? -1 : 1))
}

/** Blips that should appear in the review feed at all (not the schedule filter). */
export function liveBlips(blips: Blip[]): Blip[] {
  return blips.filter((b) => !b.deleted)
}
