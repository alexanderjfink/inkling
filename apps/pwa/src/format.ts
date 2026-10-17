/** Presentation helpers. Dates are formatted here, not in the domain. */

const DAY_MS = 86_400_000

/** "until tomorrow", "until Friday", "until Mar 4" — how the defer button reads. */
export function formatDeferral(until: string, from: Date = new Date()): string {
  const target = new Date(until)
  const days = Math.round((target.getTime() - from.getTime()) / DAY_MS)
  if (days <= 0) return 'until later today'
  if (days === 1) return 'until tomorrow'
  if (days <= 7) return `until ${target.toLocaleDateString(undefined, { weekday: 'long' })}`
  return `until ${target.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** A move's timestamp: the time if it was today, the date otherwise. */
export function formatWhen(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  if (then.toDateString() === now.toDateString()) {
    return then.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  }
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** "just now", "20 min ago", "3 hours ago", then a date — for anything recent. */
export function formatAgo(value: string, now: Date = new Date()): string {
  const then = new Date(value)
  if (Number.isNaN(then.getTime())) return ''
  const minutes = Math.floor((now.getTime() - then.getTime()) / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return then.toLocaleDateString()
}

/** "Tue" — a weekday in three letters, for a label with no room for the whole name. */
export function formatShortWeekday(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short' }).replace('.', '')
}
