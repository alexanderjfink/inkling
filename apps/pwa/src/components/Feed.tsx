import type { Blip, LLMProvider, RelatedBlip } from '@inkling/domain'
import { buildDailyFeed } from '@inkling/domain'
import { useEffect, useMemo, useState } from 'react'
import type { InklingActions } from '../state/useInkling'
import { MoveCard } from './MoveCard'

type Decision = 'advanced' | 'snoozed' | 'retired' | 'pinned'

export function Feed({
  blips,
  actions,
  provider,
  related,
}: {
  blips: Blip[]
  actions: InklingActions
  provider: LLMProvider
  related: Map<string, RelatedBlip[]>
}) {
  const [topicsText, setTopicsText] = useState('')
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [noteOpen, setNoteOpen] = useState<string | null>(null)
  const [note, setNote] = useState('')

  // Topics you engaged with this session join the context. This is what makes a
  // blip you advanced earlier pull its relatives forward — the paper's contextual
  // resurfacing, driven by your own attention rather than by a schedule.
  const engagedTopics = useMemo(() => {
    const topics = new Set<string>()
    for (const [id, decision] of Object.entries(decisions)) {
      if (decision !== 'advanced') continue
      const blip = blips.find((candidate) => candidate.id === id)
      for (const topic of blip?.topics ?? []) topics.add(topic)
    }
    return [...topics]
  }, [decisions, blips])

  const todayTopics = useMemo(() => {
    const typed = topicsText
      .split(',')
      .map((topic) => topic.trim().toLowerCase())
      .filter(Boolean)
    return [...new Set([...typed, ...engagedTopics])]
  }, [topicsText, engagedTopics])

  const candidates = useMemo(
    () => buildDailyFeed(blips, { now: new Date(), todayTopics }),
    [blips, todayTopics],
  )

  // Freeze the session once it starts. Without this, acting on a blip re-scores
  // the feed, items disappear mid-review, and the receipt can never be reached.
  const [session, setSession] = useState<string[] | null>(null)
  useEffect(() => {
    if (session === null && candidates.length > 0) setSession(candidates.map((blip) => blip.id))
  }, [candidates, session])

  const feed = useMemo(() => {
    if (session === null) return candidates
    const byId = new Map(blips.map((blip) => [blip.id, blip]))
    return session.map((id) => byId.get(id)).filter((blip): blip is Blip => Boolean(blip))
  }, [session, candidates, blips])

  // Blips that today's context pulls in but the session did not include. Offered
  // rather than injected, so the finite list stays finite.
  const inSession = useMemo(() => new Set(feed.map((blip) => blip.id)), [feed])
  const contextMatches = useMemo(() => {
    if (todayTopics.length === 0) return []
    return blips.filter(
      (blip) =>
        !blip.deleted &&
        (blip.status === 'active' || blip.status === 'snoozed') &&
        !inSession.has(blip.id) &&
        (blip.schedule.triggers.some((trigger) => todayTopics.includes(trigger)) ||
          blip.topics.some((topic) => todayTopics.includes(topic))),
    )
  }, [blips, todayTopics, inSession])

  const cleared = feed.filter((blip) => decisions[blip.id]).length
  const finished = feed.length > 0 && cleared === feed.length
  const titleOf = (id: string) => blips.find((blip) => blip.id === id)?.title ?? id.slice(0, 6)

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
        onChange={(event) => setTopicsText(event.target.value)}
        placeholder="on your mind right now? (comma separated, e.g. timeful texts)"
        className="w-full rounded-xl border border-zinc-800 bg-zinc-900/40 p-2 text-xs text-zinc-300 outline-none focus:border-zinc-600"
      />

      {contextMatches.length > 0 ? (
        <button
          type="button"
          onClick={() =>
            setSession((current) => [...(current ?? []), ...contextMatches.map((b) => b.id)])
          }
          className="rounded-xl border border-sky-900/60 bg-sky-950/20 p-2 text-left text-xs text-sky-300"
        >
          {contextMatches.length} more blip{contextMatches.length === 1 ? '' : 's'} match this
          context — bring {contextMatches.length === 1 ? 'it' : 'them'} in
        </button>
      ) : null}

      {feed.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 p-4 text-sm text-zinc-500">
          Nothing to review. Capture something, or check the attic.
        </p>
      ) : null}

      {feed.map((blip) => {
        const decision = decisions[blip.id]
        const images = blip.entries.filter((entry) => entry.kind === 'media')
        const notes = blip.entries.filter((entry) => entry.kind === 'note')
        const relatedBlips = related.get(blip.id) ?? []
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
                {notes.map((entry) => (
                  <li key={entry.id} className="text-xs text-zinc-400">
                    · {entry.text}
                  </li>
                ))}
              </ul>
            ) : null}

            {blip.links.length > 0 ? (
              <p className="mt-2 text-xs text-zinc-500">
                linked: {blip.links.map((id) => titleOf(id)).join(', ')}
              </p>
            ) : null}

            {relatedBlips.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1 rounded-lg border border-zinc-800/70 bg-zinc-900/30 p-2">
                {relatedBlips.map((entry) => (
                  <li key={entry.blip.id} className="text-xs text-zinc-400">
                    <span className="text-zinc-300">{entry.blip.title}</span>
                    <span className="text-zinc-600"> — {entry.reasons.join('; ')}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {decision ? (
              <p className="mt-3 text-xs text-zinc-500">→ {decision}</p>
            ) : (
              <>
                <MoveCard
                  blip={blip}
                  related={relatedBlips.map((entry) => entry.blip)}
                  provider={provider}
                  actions={actions}
                  onComplete={() => decide(blip.id, 'advanced')}
                />
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
              </>
            )}

            {noteOpen === blip.id ? (
              <div className="mt-3 flex flex-col gap-2">
                <textarea
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
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
            Today: {Object.values(decisions).filter((value) => value === 'advanced').length}{' '}
            advanced · {Object.values(decisions).filter((value) => value === 'snoozed').length}{' '}
            snoozed · {Object.values(decisions).filter((value) => value === 'retired').length}{' '}
            retired · {Object.values(decisions).filter((value) => value === 'pinned').length} to
            desktop · nothing lost.
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
