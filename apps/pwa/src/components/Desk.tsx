import type { Blip } from '@inkling/domain'
import type { InklingActions } from '../state/useInkling'

/**
 * The desktop end of the phone ⇄ desktop handoff.
 *
 * Low-energy moments on the phone are for noticing; flow states at the desk are for
 * working. "Send to desktop" is the bridge — it says "I want to spend real attention
 * on this one, later, at a keyboard", without committing to a time.
 */
export function Desk({ blips, actions }: { blips: Blip[]; actions: InklingActions }) {
  const pinned = blips.filter((blip) => !blip.deleted && blip.desktopPinned)
  const titleOf = (id: string) => blips.find((blip) => blip.id === id)?.title ?? id.slice(0, 6)

  if (pinned.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">
        Nothing waiting at the desk.
        <p className="mt-2 text-xs text-zinc-600">
          On the phone, tap <span className="text-zinc-400">Send to desktop</span> on a blip and it
          will appear here — primed for a flow state, without committing to a time.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">
        At the desk <span className="text-zinc-600">· {pinned.length}</span>
      </h2>

      {pinned.map((blip) => {
        const notes = blip.entries.filter((entry) => entry.kind === 'note')
        return (
          <article key={blip.id} className="rounded-2xl border border-sky-900/50 p-4">
            <div className="mb-1 flex items-center gap-2 text-[10px] tracking-wide text-zinc-500 uppercase">
              <span className="rounded-full bg-zinc-800 px-2 py-0.5">{blip.type}</span>
              <span className="text-sky-400">▸ from the phone</span>
            </div>
            <h3 className="text-base font-medium text-zinc-100">{blip.title}</h3>
            {blip.body && blip.body !== blip.title ? (
              <p className="mt-1 text-sm text-zinc-400">{blip.body}</p>
            ) : null}

            {notes.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {notes.map((entry) => (
                  <li key={entry.id} className="text-xs text-zinc-400">
                    · {entry.text}
                  </li>
                ))}
              </ul>
            ) : null}

            {blip.topics.length > 0 ? (
              <p className="mt-2 text-xs text-zinc-500">#{blip.topics.join(' #')}</p>
            ) : null}

            {blip.links.length > 0 ? (
              <p className="mt-2 text-xs text-zinc-500">
                related: {blip.links.map((id) => titleOf(id)).join(', ')}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void actions.unpinFromDesktop(blip.id)}
                className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900"
              >
                Done here
              </button>
              <button
                type="button"
                onClick={() => void actions.retire(blip.id)}
                className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500"
              >
                Retire
              </button>
            </div>
          </article>
        )
      })}
    </div>
  )
}
