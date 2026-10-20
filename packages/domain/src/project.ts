import type {
  BlipContext,
  BlipEvent,
  BlipType,
  Block,
  CaptureInput,
  Entry,
  FriendNote,
  ISODate,
  MoveSpec,
  RejectionContext,
  Visibility,
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
  outcome: 'shown' | 'done' | 'skipped' | 'rejected'
  /** When it was completed, if it was. */
  doneAt?: string
}

/** A suggestion judged bad, with the evidence for why. */
export interface MoveRejection {
  moveId: string
  spec: MoveSpec
  at: string
  reason?: string
  note?: string
  context: RejectionContext
}

export type BlipStatus = 'active' | 'snoozed' | 'retired' | 'promoted'

/** A move a friend suggested for this Inkling. */
export interface FriendMoveEntry {
  messageId: string
  from: string
  fromUsername: string
  spec: MoveSpec
  note?: string
  at: ISODate
  /** Somebody pressed "not this move". It stays in the history and stops being shown. */
  dismissed?: boolean
}

/** Having asked a friend for help with this Inkling. */
export interface FriendAskEntry {
  messageId: string
  to: string
  toUsername: string
  at: ISODate
}

/**
 * The moves from friends still waiting, oldest first.
 *
 * What makes them pop: somebody spent a moment on your behalf, and one should be in front of
 * you until you have said something back — then it becomes an ordinary Inkling again rather
 * than pinning itself to the top of the stack forever.
 *
 * Sequential rather than piled up: "two people suggested something" is two things to do, and a
 * card with both of them on it is a card you read instead of one you act on. The one that has
 * been waiting longest goes first.
 *
 * A move is done when an entry names it. Comparing timestamps against the newest entry — what
 * this did first — cannot work with more than one: a single entry dated after both of them
 * tidied them both away, and the second move was never seen.
 */
export function pendingFriendMoves(blip: Blip): FriendMoveEntry[] {
  const answered = new Set(
    blip.entries
      .map((entry) => entry.fromMessageId)
      .filter((id): id is string => typeof id === 'string'),
  )
  return blip.friendMoves
    .filter((move) => !move.dismissed && !answered.has(move.messageId))
    .sort((a, b) => (a.at === b.at ? 0 : a.at < b.at ? -1 : 1))
}

/**
 * The first move a friend is still waiting on, if any.
 *
 * Kept as a question in its own right because the schedule asks it separately: somebody
 * having thought about your Inkling is a reason for it to come round, whether or not anybody
 * has done anything about it yet.
 */
export function unansweredFriendMove(blip: Blip): FriendMoveEntry | undefined {
  return pendingFriendMoves(blip)[0]
}

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
  /** Suggestions judged bad, kept with the context they were made in. */
  rejections: MoveRejection[]
  /** Written by the app as an example, so the card can say so and offer to take it away. */
  demo?: boolean
  /** Who may be shown this. Private unless the person said otherwise. */
  visibility: Visibility
  /** Moves a friend thought of, newest last. */
  friendMoves: FriendMoveEntry[]
  /** Who has been asked for help with this, so the card can say so. */
  friendAsks: FriendAskEntry[]
  /** Notes from and to friends about this Inkling. */
  friendNotes: FriendNote[]
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
      demo: event.demo,
      visibility: event.visibility ?? 'private',
      friendMoves: [],
      friendAsks: [],
      friendNotes: [],
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
      rejections: [],
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
      // `moveId` lives on the event, so copy it onto the entry: the projection is what
      // everything downstream reads, and the link has to survive the fold.
      blip.entries.push({
        ...event.entry,
        ...(event.moveId ? { moveId: event.moveId } : {}),
        ...(event.fromMessageId ? { fromMessageId: event.fromMessageId } : {}),
      })
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
    case 'blockRemoved':
      blip.blocks = blip.blocks.filter((b) => b.id !== event.blockId)
      break
    case 'moveShown': {
      /**
       * One move is one row, however many times it was put in front of you and however many times
       * the app re-worded it on the way.
       *
       * The identity is the move's id, not its title. The title used to be part of it, on the
       * grounds that a re-adapted move is a different thing shown — true about the record, and
       * wrong about the display: a playbook move the model re-worded three times was three rows
       * on the card, all saying the same thing. That is what "shows that move a bunch of times
       * on top of each other" was.
       */
      const known = blip.moves.find((entry) => entry.moveId === event.moveId)
      if (known) {
        // Shown again: keep the newest words and the newest time, and leave the outcome alone —
        // having done it once is not undone by looking at it again.
        known.spec = event.moveSpec
        known.shownAt = event.at
        break
      }
      blip.moves.push({
        moveId: event.moveId,
        spec: event.moveSpec,
        shownAt: event.at,
        outcome: 'shown',
      })
      blip.schedule.timesShown += 1
      break
    }
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
    case 'moveRejected':
      blip.rejections.push({
        moveId: event.moveId,
        spec: event.moveSpec,
        at: event.at,
        reason: event.reason,
        note: event.note,
        context: event.context,
      })
      // And in the history, so it is not offered again — and so the move log shows it as
      // rejected rather than as something that was merely put in front of you.
      {
        const entry = blip.moves.find((move) => move.moveId === event.moveId)
        if (entry) entry.outcome = 'rejected'
        else {
          blip.moves.push({
            moveId: event.moveId,
            spec: event.moveSpec,
            shownAt: event.at,
            outcome: 'rejected',
          })
        }
      }
      break
    case 'moveSaved':
      blip.savedMove = event.moveSpec
      break
    case 'moveUnsaved':
      if (blip.savedMove?.id === event.moveId) blip.savedMove = undefined
      break
    case 'movesForgotten':
      // Only the offers go. A move that was actually done, or deliberately put down, is
      // a record of something the person did, and forgetting it would be losing data
      // rather than correcting a mistake.
      blip.moves = blip.moves.filter((entry) => entry.outcome !== 'shown')
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
    case 'shared':
      blip.visibility = event.visibility
      break
    case 'friendMove':
      // Keyed on the message, not on the arrival: the same message reaching two devices
      // is one move from one friend, and a card that says it twice is a card that looks
      // broken.
      if (!blip.friendMoves.some((move) => move.messageId === event.messageId)) {
        blip.friendMoves.push({
          messageId: event.messageId,
          from: event.from,
          fromUsername: event.fromUsername,
          spec: event.moveSpec,
          note: event.note,
          at: event.at,
        })
      }
      break
    case 'friendAsk':
      // Only the ones you sent land on a card: an ask you received is about somebody
      // else's Inkling and has a fresh id, so the fold has already passed over it.
      if (
        event.direction === 'out' &&
        !blip.friendAsks.some((ask) => ask.messageId === event.messageId)
      ) {
        blip.friendAsks.push({
          messageId: event.messageId,
          to: event.userId,
          toUsername: event.username,
          at: event.at,
        })
      }
      break
    case 'friendNote':
      // Only the ones received: a note you sent is about somebody else's Inkling and
      // carries a fresh id, so the fold has already passed over it.
      if (
        event.note.direction === 'in' &&
        !blip.friendNotes.some((note) => note.id === event.note.id)
      ) {
        blip.friendNotes.push(event.note)
      }
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

  /**
   * Apply "not this move" after everything else.
   *
   * A dismissal can be merged in before the move it refers to — two devices, two orders — and
   * the fold has to give the same answer either way. Doing it in the pass above made the
   * answer depend on which arrived first, which is the one thing a fold must never do.
   */
  for (const event of sorted) {
    if (event.t !== 'friendMoveDismissed') continue
    const blip = map.get(event.id)
    const move = blip?.friendMoves.find((candidate) => candidate.messageId === event.messageId)
    if (move) move.dismissed = true
  }

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
