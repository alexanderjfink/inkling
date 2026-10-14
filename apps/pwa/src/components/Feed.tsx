import { type Blip, buildDailyFeed } from '@inkling/domain'
import { useEffect, useMemo, useState } from 'react'
import type { InklingActions } from '../state/useInkling'

type Decision = 'advanced' | 'snoozed' | 'retired' | 'pinned'

export function Feed({ blips, actions }: { blips: Blip[]; actions: InklingActions }) {
  const [topicsText, setTopicsText] = useState('')
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [noteOpen, setNoteOpen] = useState<string | null>(null)
  const [note, setNote] = useState('')

  const todayTopics = useMemo(
    () =>
      topicsText
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    [topicsText],
  )

  const candidates = useMemo(
    () => buildDailyFeed(blips, { now: new Date(), todayTopics }),
    [blips, todayTopics],
  )

  // Freeze the session once it starts. Without this, acting on a blip re-scores
  // the feed, items disappear mid-review, and the receipt can never be reached.
  const [session, setSession] = useState<string[] | null>(null)
  useEffect(() => {
    if (session === null && candidates.length > 0) setSession(candidates.map((b) => b.id))
  }, [candidates, session])

  const feed = useMemo(() => {
    if (session === null) return candidates
    const byId = new Map(blips.map((b) => [b.id, b]))
    return session.map((id) => byId.get(id)).filter((b): b is Blip => Boolean(b))
  }, [session, candidates, blips])

  const cleared = feed.filter((b) => decisions[b.id]).length
  const finished = feed.length > 0 && cleared === feed.length
  const titleOf = (id: string) => blips.find((b) => b.id === id)?.title ?? id.slice(0, 6)

  function decide(id: string, decision: Decision) {
    setDecisions((prev) => ({ ...prev, [id]: decision }))
  }

  async function saveNote(blip: Blip) {
    if (!note.trim()) return
    await actions.addNote(blip.id, note.trim())
    await actions.snoozeAfter(blip.id, 'engaged', blip.schedule.timesEngaged)
    setNote('')
    setNoteOpen(null)
    decide(blip.id, 'advanced')
  }

  async function snooze(blip: Blip) {
    await actions.snoozeAfter(blip.id, 'skipped', blip.schedule.timesSkipped)
    decide(blip.id, 'snoozed')
  }

  async function retire(blip: Blip) {
    await actions.retire(blip.id)
    decide(blip.id, 'retired')
  }

  async function pin(blip: Blip) {
    await actions.pinToDesktop(blip.id)
    decide(blip.id, 'pinned')
  }

  function nextSession() {
    setDecisions({})
    setNoteOpen(null)
    setSession(null)
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold tracking-wide text-zinc-400 uppercase">Today</h2>
        <span className="text-xs text-zinc-500">
          {feed.length === 0 ? 'nothing due' : `${cleared} of ${feed.length} cleared`}
        </span>
      </div>

      <input
        value={topicsText}
        onChange={(e) => setTopicsText(e.target.value)}
        placeholder="on your mind right now? (comma separated, e.g. timeful texts)"
        className="w-full rounded-xl border border-zinc-800 bg-zinc-900/40 p-2 text-xs text-zinc-300 outline-none focus:border-zinc-600"
      />

      {feed.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">
          Nothing to review. Capture something, or check the attic.
        </p>
      ) : null}

      {feed.map((blip) => {
        const decision = decisions[blip.id]
        const images = blip.entries.filter((e) => e.kind === 'media')
        const notes = blip.entries.filter((e) => e.kind === 'note')
        return (
          <article
            key={blip.id}
            className={`rounded-2xl border p-4 transition ${
              decision ? 'border-zinc-800/50 opacity-50' : 'border-zinc-800'
            }`}
          >
            <div className="mb-1 flex items-center gap-2 text-[10px] tracking-wide text-zinc-500 uppercase">
              <span className="rounded-full bg-zinc-800 px-2 py-0.5">{blip.type}</span>
              <span>heat {blip.schedule.heat.toFixed(1)}</span>
              {blip.desktopPinned ? <span className="text-sky-400">▸ on desktop</span> : null}
            </div>
            <h3 className="text-base font-medium text-zinc-100">{blip.title}</h3>
            {blip.body && blip.body !== blip.title ? (
              <p className="mt-1 text-sm text-zinc-400">{blip.body}</p>
            ) : null}
            {blip.input?.url ? (
              <a
                href={blip.input.url}
                target="_blank"
                rel="noreferrer"
                className="mt-1 block truncate text-xs text-sky-400 underline"
              >
                {blip.input.url}
              </a>
            ) : null}
            {images.length > 0 ? (
              <p className="mt-2 text-xs text-zinc-500">🖼 {images.length} image attachment(s)</p>
            ) : null}
            {notes.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {notes.map((e) => (
                  <li key={e.id} className="text-xs text-zinc-400">
                    · {e.text}
                  </li>
                ))}
              </ul>
            ) : null}

            {blip.links.length > 0 ? (
              <p className="mt-2 text-xs text-zinc-500">
                related: {blip.links.map((id) => titleOf(id)).join(', ')}
              </p>
            ) : null}

            {decision ? (
              <p className="mt-3 text-xs text-zinc-500">→ {decision}</p>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setNoteOpen(noteOpen === blip.id ? null : blip.id)
                    setNote('')
                  }}
                  className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900"
                >
                  Add a note
                </button>
                <button
                  type="button"
                  onClick={() => snooze(blip)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
                >
                  Not now
                </button>
                <button
                  type="button"
                  onClick={() => pin(blip)}
                  className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300"
                >
                  Send to desktop
                </button>
                <button
                  type="button"
                  onClick={() => retire(blip)}
                  className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs text-zinc-500"
                >
                  Retire
                </button>
              </div>
            )}

            {noteOpen === blip.id ? (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="What are you thinking?"
                  className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
                />
                <button
                  type="button"
                  onClick={() => saveNote(blip)}
                  className="self-end rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900"
                >
                  Save & advance
                </button>
              </div>
            ) : null}
          </article>
        )
      })}

      {finished ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-emerald-900/60 bg-emerald-950/30 p-4 text-sm text-emerald-200">
          <p>
            Today: {Object.values(decisions).filter((d) => d === 'advanced').length} advanced ·{' '}
            {Object.values(decisions).filter((d) => d === 'snoozed').length} snoozed ·{' '}
            {Object.values(decisions).filter((d) => d === 'retired').length} retired ·{' '}
            {Object.values(decisions).filter((d) => d === 'pinned').length} to desktop · nothing
            lost.
          </p>
          <button
            type="button"
            onClick={nextSession}
            className="self-start rounded-lg border border-emerald-800 px-3 py-1.5 text-xs text-emerald-200"
          >
            New session
          </button>
        </div>
      ) : null}
    </div>
  )
}
