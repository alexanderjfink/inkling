import type { Blip } from '@inkling/domain'
import type { InklingActions } from '../state/useInkling'

function Row({ blip, actions }: { blip: Blip; actions: InklingActions }) {
  const when = new Date(blip.created).toLocaleDateString()
  return (
    <div className="rounded-xl border border-zinc-800 p-3">
      <div className="flex items-center gap-2 text-[10px] tracking-wide text-zinc-500 uppercase">
        <span className="rounded-full bg-zinc-800 px-2 py-0.5">{blip.type}</span>
        <span>{when}</span>
        <span>{blip.entries.length} entries</span>
        {blip.desktopPinned ? <span className="text-sky-400">▸ desktop</span> : null}
      </div>
      <p className="mt-1 text-sm font-medium text-zinc-100">{blip.title}</p>
      {blip.topics.length > 0 ? (
        <p className="mt-1 text-xs text-zinc-500">#{blip.topics.join(' #')}</p>
      ) : null}
      <div className="mt-2 flex gap-2">
        {blip.status === 'retired' ? (
          <button
            type="button"
            onClick={() => actions.revive(blip.id)}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
          >
            Revive
          </button>
        ) : (
          <button
            type="button"
            onClick={() => actions.retire(blip.id)}
            className="rounded-lg border border-zinc-800 px-2 py-1 text-xs text-zinc-500"
          >
            Retire
          </button>
        )}
        {!blip.desktopPinned ? (
          <button
            type="button"
            onClick={() => actions.pinToDesktop(blip.id)}
            className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-zinc-300"
          >
            Send to desktop
          </button>
        ) : null}
      </div>
    </div>
  )
}

export function AllBlips({ blips, actions }: { blips: Blip[]; actions: InklingActions }) {
  const groups: Array<{ label: string; items: Blip[] }> = [
    { label: 'Active', items: blips.filter((b) => !b.deleted && b.status === 'active') },
    { label: 'Snoozed', items: blips.filter((b) => !b.deleted && b.status === 'snoozed') },
    {
      label: 'Promoted to notes',
      items: blips.filter((b) => !b.deleted && b.status === 'promoted'),
    },
    { label: 'Attic (retired)', items: blips.filter((b) => !b.deleted && b.status === 'retired') },
  ]

  if (blips.filter((b) => !b.deleted).length === 0) {
    return (
      <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">
        Nothing captured yet. Start with one thing you noticed today.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {groups
        .filter((group) => group.items.length > 0)
        .map((group) => (
          <section key={group.label} className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
              {group.label} <span className="text-zinc-600">· {group.items.length}</span>
            </h2>
            {group.items.map((blip) => (
              <Row key={blip.id} blip={blip} actions={actions} />
            ))}
          </section>
        ))}
    </div>
  )
}
