import type { Blip } from '@inkling/domain'
import { isDue } from '@inkling/domain'
import { useState } from 'react'
import { formatShortDate } from '../format'
import { obsidianUri } from '../obsidian'
import { useLayout } from '../state/useLayout'
import type { InklingActions } from '../state/useInkling'

function Row({
  blip,
  actions,
  onOpen,
  vault,
}: {
  blip: Blip
  actions: InklingActions
  onOpen: (id: string) => void
  vault: string
}) {
  // "This one has a note" is worth knowing while scanning the attic.
  const note = blip.export?.notePath
  const gone = blip.status === 'retired' || blip.status === 'promoted'

  return (
    <div className="card flex flex-col gap-2 p-4">
      <button
        type="button"
        onClick={() => onOpen(blip.id)}
        className="flex flex-col gap-2 text-left"
      >
        <span className="flex flex-wrap items-center gap-2 text-xs tracking-wide text-ink-faint uppercase">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">{blip.type}</span>
          <span>{formatShortDate(blip.created)}</span>
          <span>{blip.entries.length} entries</span>
          {note ? <span className="text-good">→ note</span> : null}
        </span>
        <span className="text-sm font-medium">{blip.title}</span>
        {blip.topics.length > 0 ? (
          <span className="text-xs text-ink-faint">#{blip.topics.join(' #')}</span>
        ) : null}
      </button>

      <div className="flex flex-wrap gap-2">
        {gone ? (
          <button
            type="button"
            onClick={() => void actions.revive(blip.id)}
            className="rounded-full border border-line px-3 py-1.5 text-xs"
          >
            Revive
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void actions.retire(blip.id)}
            className="quiet rounded-full border border-line px-3 py-1.5 text-xs"
          >
            Retire
          </button>
        )}
        {note ? (
          <a
            href={obsidianUri(vault, note)}
            className="rounded-full border border-line px-3 py-1.5 text-xs text-good"
          >
            Open the note
          </a>
        ) : null}
        <button
          type="button"
          onClick={() => onOpen(blip.id)}
          className="quiet rounded-full border border-line px-3 py-1.5 text-xs"
        >
          Open
        </button>
      </div>
    </div>
  )
}

type Filter = 'all' | 'waiting' | 'down' | 'attic'
type Sort = { by: 'title' | 'updated' | 'created'; desc: boolean }

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'waiting', label: 'Waiting' },
  { id: 'down', label: 'Put down' },
  { id: 'attic', label: 'Attic' },
]

/**
 * The list as a table, for any screen with room for columns.
 *
 * Cards are the right shape when each one is the whole screen. A hundred cards is not a list
 * you can scan: what you want is the questions a table answers in one glance — what kind of
 * thing is it, is it waiting, how much have I written on it, when did I last touch it.
 */
function Table({
  blips,
  onOpen,
  vault,
}: {
  blips: Blip[]
  onOpen: (id: string) => void
  vault: string
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>({ by: 'updated', desc: true })
  const now = new Date()
  const gone = (blip: Blip) => blip.status === 'retired' || blip.status === 'promoted'
  const state = (blip: Blip): Filter =>
    gone(blip) ? 'attic' : isDue(blip, now) ? 'waiting' : 'down'

  const counts: Record<Filter, number> = {
    all: blips.length,
    waiting: blips.filter((blip) => state(blip) === 'waiting').length,
    down: blips.filter((blip) => state(blip) === 'down').length,
    attic: blips.filter((blip) => state(blip) === 'attic').length,
  }

  const direction = sort.desc ? -1 : 1
  const rows = (filter === 'all' ? blips : blips.filter((blip) => state(blip) === filter))
    .slice()
    .sort((a, b) =>
      sort.by === 'title'
        ? a.title.localeCompare(b.title) * direction
        : a[sort.by].localeCompare(b[sort.by]) * direction,
    )

  function head(by: Sort['by'], label: string, className = '') {
    const active = sort.by === by
    return (
      <th className={`py-2 pr-4 text-left font-normal ${className}`}>
        <button
          type="button"
          onClick={() =>
            setSort((previous) =>
              previous.by === by ? { by, desc: !previous.desc } : { by, desc: by !== 'title' },
            )
          }
          className={`transition hover:text-ink ${active ? 'font-medium text-ink' : ''}`}
        >
          {label}
          {active ? <span className="ml-1">{sort.desc ? '↓' : '↑'}</span> : null}
        </button>
      </th>
    )
  }

  return (
    <div className="flex min-h-0 max-w-[860px] flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setFilter(option.id)}
            className={`rounded-full px-3 py-1 text-xs whitespace-nowrap transition ${
              filter === option.id
                ? 'bg-ink font-medium text-surface'
                : 'border border-line text-ink-soft hover:border-ink-faint'
            }`}
          >
            {option.label}
            {counts[option.id] > 0 ? ` · ${counts[option.id]}` : ''}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="px-3 py-6 text-sm text-ink-faint">Nothing here.</p>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10 bg-canvas text-xs tracking-wide text-ink-faint uppercase">
              <tr>
                {head('title', 'Inkling')}
                <th className="w-24 py-2 pr-4 text-left font-normal">Type</th>
                <th className="w-24 py-2 pr-4 text-left font-normal">State</th>
                {head('updated', 'Touched', 'w-28')}
                <th className="w-20 py-2 text-right font-normal">Entries</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((blip) => {
                const note = blip.export?.notePath
                const where = state(blip)
                return (
                  <tr
                    key={blip.id}
                    onClick={() => onOpen(blip.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onOpen(blip.id)
                      }
                    }}
                    tabIndex={0}
                    // A row is the target, so it has to be reachable and say so.
                    aria-label={`Open ${blip.title}`}
                    className="group cursor-pointer border-line border-t outline-none transition hover:bg-surface focus-visible:bg-surface"
                  >
                    <td className="max-w-0 py-2.5 pr-4">
                      <span className="flex items-baseline gap-2">
                        <span className="min-w-0 truncate font-medium">{blip.title}</span>
                        {note ? <span className="shrink-0 text-xs text-good">→ note</span> : null}
                      </span>
                      {blip.topics.length > 0 ? (
                        <span className="block truncate text-xs text-ink-faint">
                          #{blip.topics.join(' #')}
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                        {blip.type}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs whitespace-nowrap">
                      <span
                        className={
                          where === 'attic'
                            ? 'text-ink-faint'
                            : where === 'waiting'
                              ? 'text-good'
                              : 'text-ink-soft'
                        }
                      >
                        {where === 'attic'
                          ? blip.status === 'promoted'
                            ? 'promoted'
                            : 'retired'
                          : where === 'waiting'
                            ? 'waiting'
                            : 'put down'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 text-xs whitespace-nowrap text-ink-faint">
                      {formatShortDate(blip.updated)}
                    </td>
                    <td className="py-2.5 text-right text-xs text-ink-faint">
                      {blip.entries.length}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* The one thing a row cannot do: put it back. It lives here rather than in the row so a
          mis-click on a long list cannot retire anything. */}
      <p className="text-xs text-ink-faint">
        {vault ? 'Open a row to read it, export it, or let it go.' : 'Open a row to read it.'}
        {rows.length > 0 ? ` ${rows.length} shown.` : ''}
      </p>
    </div>
  )
}

/**
 * Everything, including what you put down and what you let go of.
 *
 * Promoted blips sit here beside retired ones: both have left the feed, and both can
 * be revived. The difference is kept visible rather than merged away — a promoted
 * blip carries its note, and says so, with a link to open it.
 */
export function AllBlips({
  blips,
  actions,
  onOpen,
  vault,
}: {
  blips: Blip[]
  actions: InklingActions
  onOpen: (id: string) => void
  vault: string
}) {
  const layout = useLayout()
  const live = blips.filter((blip) => !blip.deleted)
  const now = new Date()
  const gone = (b: Blip) => b.status === 'retired' || b.status === 'promoted'

  if (live.length === 0) {
    return <p className="text-sm text-ink-faint">Nothing captured yet.</p>
  }

  if (layout !== 'compact') {
    return <Table blips={live} onOpen={onOpen} vault={vault} />
  }

  const groups: Array<{ label: string; items: Blip[] }> = [
    { label: 'Waiting', items: live.filter((b) => !gone(b) && isDue(b, now)) },
    { label: 'Put down', items: live.filter((b) => !gone(b) && !isDue(b, now)) },
    { label: 'Attic', items: live.filter(gone) },
  ]

  return (
    <div className="flex flex-1 flex-col gap-6">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h2 className="text-xs tracking-wide text-ink-faint uppercase">
              {group.label} · {group.items.length}
            </h2>
            {group.items.map((blip) => (
              <Row key={blip.id} blip={blip} actions={actions} onOpen={onOpen} vault={vault} />
            ))}
          </section>
        ))}
    </div>
  )
}
