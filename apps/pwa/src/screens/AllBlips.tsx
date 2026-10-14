import type { Blip } from '@inkling/domain'
import { isDue } from '@inkling/domain'
import { formatShortDate } from '../format'
import type { InklingActions } from '../state/useInkling'

function Row({ blip, actions }: { blip: Blip; actions: InklingActions }) {
  return (
    <div className="card flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-2 text-[11px] tracking-wide text-ink-faint uppercase">
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">{blip.type}</span>
        <span>{formatShortDate(blip.created)}</span>
        <span>{blip.entries.length} entries</span>
        {blip.desktopPinned ? <span className="text-accent">▸ to Mac</span> : null}
      </div>
      <p className="text-sm font-medium">{blip.title}</p>
      {blip.topics.length > 0 ? (
        <p className="text-xs text-ink-faint">#{blip.topics.join(' #')}</p>
      ) : null}
      <div className="flex gap-2 pt-1">
        {blip.status === 'retired' ? (
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
        {!blip.desktopPinned && blip.status !== 'retired' ? (
          <button
            type="button"
            onClick={() => void actions.pinToDesktop(blip.id)}
            className="quiet rounded-full border border-line px-3 py-1.5 text-xs"
          >
            Send to Mac
          </button>
        ) : null}
      </div>
    </div>
  )
}

/** Everything, including what you put down and what you let go of. */
export function AllBlips({ blips, actions }: { blips: Blip[]; actions: InklingActions }) {
  const live = blips.filter((blip) => !blip.deleted)
  const now = new Date()

  const groups: Array<{ label: string; items: Blip[] }> = [
    {
      label: 'Waiting',
      items: live.filter((b) => b.status !== 'retired' && b.status !== 'promoted' && isDue(b, now)),
    },
    {
      label: 'Put down',
      items: live.filter(
        (b) => b.status !== 'retired' && b.status !== 'promoted' && !isDue(b, now),
      ),
    },
    { label: 'Notes', items: live.filter((b) => b.status === 'promoted') },
    { label: 'Attic', items: live.filter((b) => b.status === 'retired') },
  ]

  if (live.length === 0) {
    return <p className="text-sm text-ink-faint">Nothing captured yet.</p>
  }

  return (
    <div className="flex flex-1 flex-col gap-6">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h2 className="text-[11px] tracking-wide text-ink-faint uppercase">
              {group.label} · {group.items.length}
            </h2>
            {group.items.map((blip) => (
              <Row key={blip.id} blip={blip} actions={actions} />
            ))}
          </section>
        ))}
    </div>
  )
}
