import type { Blip } from '@inkling/domain'
import { isDue } from '@inkling/domain'
import { formatShortDate } from '../format'
import { obsidianUri } from '../obsidian'
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
        <span className="flex flex-wrap items-center gap-2 text-[11px] tracking-wide text-ink-faint uppercase">
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
  const live = blips.filter((blip) => !blip.deleted)
  const now = new Date()
  const gone = (b: Blip) => b.status === 'retired' || b.status === 'promoted'

  const groups: Array<{ label: string; items: Blip[] }> = [
    { label: 'Waiting', items: live.filter((b) => !gone(b) && isDue(b, now)) },
    { label: 'Put down', items: live.filter((b) => !gone(b) && !isDue(b, now)) },
    { label: 'Attic', items: live.filter(gone) },
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
              <Row key={blip.id} blip={blip} actions={actions} onOpen={onOpen} vault={vault} />
            ))}
          </section>
        ))}
    </div>
  )
}
