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
