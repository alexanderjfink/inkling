import {
  type Blip,
  type BlipEvent,
  type Overview,
  type PublicUser,
  parseLog,
  project,
} from '@inkling/domain'
import type { Store } from './store'

/**
 * What the server can say about how the app is actually being used.
 *
 * Read from the logs rather than from a separate tally, because the logs are the only
 * thing that is guaranteed to be there: every device writes them, sync moves them, and
 * nothing rewrites them. A counter kept alongside would be a second source of truth that
 * can disagree with the first.
 *
 * This reads everybody's data. That is inherent in the question being asked — "how is the
 * app doing across its users" cannot be answered from one account — and it is the same
 * data the server already holds in plain files on this machine. It is not, however, a
 * place to go reading people's notes: nothing here includes an Inkling's body, and the
 * feedback context carries a title only so a report can be recognised.
 */

/**
 * How many times something has to be waved away, with nothing written against it, before
 * it counts as abandoned.
 *
 * Both ways of waving it away count: "not this one" on the card, and putting it down for
 * tomorrow or a month. The fold only keeps a counter for the first, so the second is
 * counted from the events — a deferral is the more common way for something to quietly
 * stop happening, and leaving it out would miss most of what this number is for.
 */
export const ABANDONED_AT = 3

/** How many rows of the two lists to return. */
const RECENT_LIMIT = 100
const ACTIVITY_DAYS = 14

export interface AccountSource {
  user: PublicUser
  store: Store
}

export async function buildOverview(sources: AccountSource[]): Promise<Overview> {
  const now = new Date()
  const overview: Overview = {
    generatedAt: now.toISOString(),
    users: { total: sources.length, admins: 0, joinedLast7Days: 0 },
    inklings: {
      total: 0,
      active: 0,
      snoozed: 0,
      retired: 0,
      promoted: 0,
      deleted: 0,
      examples: 0,
      abandoned: 0,
      withEntries: 0,
    },
    moves: { offered: 0, done: 0, skipped: 0, rejected: 0, kept: 0 },
    badMoves: [],
    feedback: [],
    activity: [],
    devices: 0,
    unreadable: [],
  }

  const byDay = new Map<string, { events: number; captures: number }>()
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  for (const { user, store } of sources) {
    if (user.role === 'admin') overview.users.admins += 1
    if (new Date(user.createdAt) >= weekAgo) overview.users.joinedLast7Days += 1

    let events: BlipEvent[] = []
    try {
      const devices = await store.devices()
      overview.devices += devices.length
      for (const device of devices) {
        // The whole log, from zero: this is the only place that wants all of it at once.
        const bytes = await store.readLog(device.deviceId, 0)
        if (bytes.byteLength === 0) continue
        events.push(...parseLog(new TextDecoder().decode(bytes)))
      }
    } catch {
      overview.unreadable.push(user.username)
      continue
    }

    // Folded once: the tallies and the report titles are both views of the same state,
    // and folding per question would be a second chance to disagree with the first.
    const blips = project(events)
    tallyBlips(blips, deferredCounts(events), overview)
    tallyEvents(events, blips, user, overview, byDay)
  }

  overview.badMoves.sort((a, b) => (a.at < b.at ? 1 : -1))
  overview.feedback.sort((a, b) => (a.at < b.at ? 1 : -1))
  overview.badMoves = overview.badMoves.slice(0, RECENT_LIMIT)
  overview.feedback = overview.feedback.slice(0, RECENT_LIMIT)

  overview.activity = []
  for (let back = ACTIVITY_DAYS - 1; back >= 0; back -= 1) {
    const day = new Date(now.getTime() - back * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    const counts = byDay.get(day) ?? { events: 0, captures: 0 }
    overview.activity.push({ day, ...counts })
  }

  return overview
}

/** How many times each Inkling was put down for later. Not in the fold, so counted here. */
function deferredCounts(events: BlipEvent[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const event of events) {
    if (event.t !== 'snoozed') continue
    counts.set(event.id, (counts.get(event.id) ?? 0) + 1)
  }
  return counts
}

function tallyBlips(blips: Blip[], deferred: Map<string, number>, overview: Overview): void {
  for (const blip of blips) {
    overview.inklings.total += 1
    if (blip.deleted) overview.inklings.deleted += 1
    else if (blip.status === 'retired') overview.inklings.retired += 1
    else if (blip.status === 'promoted') overview.inklings.promoted += 1
    else if (blip.status === 'snoozed') overview.inklings.snoozed += 1
    else overview.inklings.active += 1

    if (blip.demo) overview.inklings.examples += 1
    if (blip.entries.length > 0) overview.inklings.withEntries += 1

    // "Abandoned" is not the same as retired: retiring is a decision, and a decision is a
    // perfectly good outcome. This is the thing that keeps coming back and never gets
    // written against, which is what a suggestion that does not fit looks like from the
    // outside. The example is excluded because it is not anybody's.
    const wavedAway = blip.schedule.timesSkipped + (deferred.get(blip.id) ?? 0)
    if (!blip.deleted && !blip.demo && blip.entries.length === 0 && wavedAway >= ABANDONED_AT) {
      overview.inklings.abandoned += 1
    }

    for (const move of blip.moves) {
      overview.moves.offered += 1
      if (move.outcome === 'done') overview.moves.done += 1
      if (move.outcome === 'skipped') overview.moves.skipped += 1
      if (move.outcome === 'rejected') overview.moves.rejected += 1
    }
    if (blip.savedMove) overview.moves.kept += 1
  }
}

function tallyEvents(
  events: BlipEvent[],
  blips: Blip[],
  user: PublicUser,
  overview: Overview,
  byDay: Map<string, { events: number; captures: number }>,
): void {
  // Titles come from the same fold, so a report can name the Inkling it was about without
  // the overview holding a second copy of every blip.
  const titles = new Map(blips.map((blip) => [blip.id, { title: blip.title, type: blip.type }]))

  for (const event of events) {
    const day = event.at.slice(0, 10)
    const counts = byDay.get(day) ?? { events: 0, captures: 0 }
    counts.events += 1
    if (event.t === 'captured') counts.captures += 1
    byDay.set(day, counts)

    if (event.t === 'moveRejected') {
      const about = titles.get(event.id)
      overview.badMoves.push({
        user: user.username,
        at: event.at,
        move: event.moveSpec.title,
        reason: event.reason ?? null,
        note: event.note ?? null,
        blipTitle: about?.title ?? '',
        blipType: about?.type ?? '',
      })
    }

    if (event.t === 'feedback') {
      const about = titles.get(event.id)
      overview.feedback.push({
        user: user.username,
        at: event.at,
        text: event.text,
        screen: event.context.screen,
        blipTitle: event.context.blip?.title ?? about?.title,
        blipType: event.context.blip?.type,
        move: event.context.move?.title,
        app: event.context.app,
        server: event.context.server,
      })
    }
  }
}
