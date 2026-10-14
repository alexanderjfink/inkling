import type { Blip } from './project'

const DAY_MS = 86_400_000

export const DEFAULT_FEED_SIZE = 6

/** Cap on how many blips sharing a topic may appear in one feed. */
const MAX_PER_TOPIC = 2
/** A blip at or below this heat counts as "cold" and deserves an occasional airing. */
const COLD_HEAT = 0.3

export interface FeedContext {
  now: Date
  /** Topics currently on your mind; matched blips score higher. */
  todayTopics?: string[]
  size?: number
}

function daysSince(iso: string, now: Date): number {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return 0
  return Math.max(0, (now.getTime() - t) / DAY_MS)
}

/**
 * Whether a blip may appear in today's feed. A missing `nextEarliest` means
 * "eligible now"; a future one means snoozed; a matching trigger overrides both.
 */
export function isDue(blip: Blip, now: Date, activeTopics: string[] = []): boolean {
  if (blip.deleted) return false
  if (blip.status === 'retired' || blip.status === 'promoted') return false
  // A matching topic trigger overrides a snooze: "show me this when I'm thinking
  // about X again" is exactly the safety the design depends on.
  const triggers = blip.schedule.triggers ?? []
  if (triggers.length && triggers.some((t) => activeTopics.includes(t))) return true
  if (blip.status !== 'active') return false
  if (!blip.schedule.nextEarliest) return true
  const due = Date.parse(blip.schedule.nextEarliest)
  return Number.isNaN(due) || due <= now.getTime()
}

/**
 * Resurfacing score. Higher is more likely to appear today.
 *
 * Note there is no overdue term: an old blip is not "late", it is merely stale,
 * which slowly raises its score. This is what keeps the feed finite and guilt-free.
 */
export function scoreBlip(blip: Blip, ctx: FeedContext): number {
  const topics = ctx.todayTopics ?? []
  const staleness = Math.log2(1 + daysSince(blip.schedule.lastTouched ?? blip.created, ctx.now))
  const heat = blip.schedule.heat
  const overlapRatio = topics.length
    ? blip.topics.filter((t) => topics.includes(t)).length / topics.length
    : 0
  const relatedActivity = Math.min(blip.links.length, 5) * 0.1
  const novelty = 1 / (1 + blip.schedule.timesShown)
  const skipPenalty = blip.schedule.timesSkipped
  return (
    1 * staleness + 2 * heat + 1.5 * overlapRatio + relatedActivity + 0.5 * novelty - skipPenalty
  )
}

function saturated(blip: Blip, counts: Map<string, number>): boolean {
  if (blip.topics.length === 0) return false
  return blip.topics.every((t) => (counts.get(t) ?? 0) >= MAX_PER_TOPIC)
}

/**
 * Build today's finite feed: due blips ranked by score, thinned so no single
 * topic dominates, always including at least one cold blip when one is available.
 */
export function buildDailyFeed(blips: Blip[], ctx: FeedContext): Blip[] {
  const size = ctx.size ?? DEFAULT_FEED_SIZE
  const topics = ctx.todayTopics ?? []

  const ranked = blips
    .filter((b) => isDue(b, ctx.now, topics))
    .map((b) => ({ blip: b, score: scoreBlip(b, ctx) }))
    .sort((x, y) => y.score - x.score || (x.blip.created < y.blip.created ? -1 : 1))

  const chosen: Blip[] = []
  const counts = new Map<string, number>()
  for (const { blip } of ranked) {
    if (chosen.length >= size) break
    if (saturated(blip, counts)) continue
    chosen.push(blip)
    for (const t of blip.topics) counts.set(t, (counts.get(t) ?? 0) + 1)
  }

  const hasCold = chosen.some((b) => b.schedule.heat <= COLD_HEAT)
  if (!hasCold && size > 0) {
    const cold = ranked.map((r) => r.blip).find((b) => b.schedule.heat <= COLD_HEAT)
    if (cold && !chosen.includes(cold)) {
      if (chosen.length >= size) chosen.pop()
      chosen.push(cold)
    }
  }

  return chosen
}

export type SnoozeReason = 'engaged' | 'skipped' | 'shown'

/**
 * Compute when a blip should next surface. Engagement stretches the interval
 * (spaced repetition for attention); skips shorten it; a bare showing barely moves it.
 */
export function snoozeUntil(reason: SnoozeReason, from: Date, streak = 0): string {
  let days: number
  switch (reason) {
    case 'engaged':
      days = Math.min(14, 3 + streak * 2)
      break
    case 'skipped':
      days = Math.max(1, 3 - streak)
      break
    default:
      days = 1
  }
  return new Date(from.getTime() + days * DAY_MS).toISOString()
}
