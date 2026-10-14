import type { Blip, DeferralChoice, LLMProvider, RelatedBlip } from '@inkling/domain'
import { DEFERRAL_CHOICES, buildDailyFeed, deferUntil, rankBlips } from '@inkling/domain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { formatDeferral } from '../format'
import { type LookupResult, lookupVia } from '../llm/proxy'
import { ButtonLabel, Spinner } from '../components/Spinner'
import type { InklingActions } from '../state/useInkling'
import type { PromoteResult } from '../state/usePromote'
import { useSuggestedMove } from '../state/useSuggestedMove'

type Decision = 'advanced' | 'deferred' | 'retired' | 'promoted' | 'revived'
/** Today's finite feed, or everything you have. */
type Scope = 'today' | 'all'

const DEFAULT_DEFERRAL: DeferralChoice = 'few-days'
const DEFERRAL_LABEL: Record<DeferralChoice, string> = {
  tomorrow: 'tomorrow',
  'few-days': 'a few days',
  'next-week': 'a week',
  'next-month': 'a month',
}

function ActionButton({
  icon,
  label,
  onClick,
  accent,
  disabled,
  busy,
  busyLabel,
}: {
  icon: string
  label: string
  onClick: () => void
  accent?: boolean
  disabled?: boolean
  busy?: boolean
  busyLabel?: string
}) {
  return (
    <div className="flex w-28 flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled || busy}
        aria-busy={busy}
        className={`circle h-[4.25rem] w-[4.25rem] ${accent ? 'circle--accent' : ''}`}
      >
        {busy ? (
          <Spinner className="h-6 w-6" />
        ) : (
          <span className="text-2xl leading-none">{icon}</span>
        )}
      </button>
      <span className="text-center text-xs text-ink-soft">
        {busy ? (busyLabel ?? label) : label}
      </span>
    </div>
  )
}

/**
 * One blip, full screen.
 *
 * The whole interface is three actions: send it to the Mac, add something to it,
 * or put it down for a while. Everything else — retiring, promoting to a note — is
 * a quiet link, because those are rare and should not compete with the main three.
 */
export function Review({
  blips,
  actions,
  provider,
  related,
  onPromote,
  promoteResults,
  promotingId,
  onExit,
  onBrowse,
  focusId,
  serverUrl,
}: {
  blips: Blip[]
  actions: InklingActions
  provider: LLMProvider
  related: Map<string, RelatedBlip[]>
  onPromote: (blip: Blip, relatedBlips: Blip[]) => Promise<PromoteResult>
  promoteResults: Record<string, PromoteResult>
  promotingId: string | null
  onExit: () => void
  onBrowse: () => void
  /** A blip picked from the list, to open first. */
  focusId?: string | null
  serverUrl: string
}) {
  const [session, setSession] = useState<string[] | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [entryOpen, setEntryOpen] = useState(false)
  const [entry, setEntry] = useState('')
  const [busy, setBusy] = useState(false)
  const [lastNote, setLastNote] = useState<{ title: string; path: string } | null>(null)
  const [material, setMaterial] = useState<LookupResult | null>(null)
  const [materialLoading, setMaterialLoading] = useState(false)
  // A blip picked from the list may not be due today, so focus starts in "all".
  const [scope, setScope] = useState<Scope>(focusId ? 'all' : 'today')

  const today = useMemo(() => buildDailyFeed(blips, { now: new Date() }), [blips])
  const everything = useMemo(() => rankBlips(blips, { now: new Date() }), [blips])
  const candidates = scope === 'today' ? today : everything

  const focus = focusId ? blips.find((blip) => blip.id === focusId) : undefined
  const focusKey = focus?.id ?? ''

  // Changing scope starts a new round, rather than mixing two queues.
  const lastScope = useRef(scope)
  useEffect(() => {
    if (lastScope.current === scope) return
    lastScope.current = scope
    setSession(null)
    setDecisions({})
    setEntryOpen(false)
    setLastNote(null)
  }, [scope])

  // Freeze the round when it starts, so acting on a blip cannot reshuffle the queue.
  useEffect(() => {
    if (session !== null) return
    const ids = candidates.map((blip) => blip.id)
    // A focused blip opens first, whether or not it is in the queue — and it opens
    // even if it is retired, which is how you get one back.
    const ordered = focusKey ? [focusKey, ...ids.filter((id) => id !== focusKey)] : ids
    if (ordered.length > 0) setSession(ordered)
  }, [candidates, session, focusKey])

  const byId = useMemo(() => new Map(blips.map((blip) => [blip.id, blip])), [blips])
  const queue = useMemo(() => {
    if (session === null) return candidates
    return session
      .map((id) => byId.get(id))
      .filter((blip): blip is Blip => blip !== undefined && !decisions[blip.id])
  }, [session, candidates, byId, decisions])

  const total = session?.length ?? candidates.length
  const done = total - queue.length
  const current = queue[0]
  const currentRelated = current ? (related.get(current.id) ?? []) : []
  const {
    move,
    loading: moveLoading,
    reroll,
  } = useSuggestedMove(
    current,
    currentRelated.map((entry_) => entry_.blip),
    provider,
  )

  const deferLabel = formatDeferral(deferUntil(DEFAULT_DEFERRAL, new Date()))

  // If the move brings something to read, go and get it.
  const materialQuery = move?.materialQuery ?? ''
  useEffect(() => {
    if (!materialQuery) {
      setMaterial(null)
      setMaterialLoading(false)
      return
    }
    let cancelled = false
    setMaterial(null)
    setMaterialLoading(true)
    void lookupVia(serverUrl, materialQuery).then((result) => {
      if (cancelled) return
      setMaterial(result)
      setMaterialLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [materialQuery, serverUrl])

  function settle(decision: Decision) {
    if (!current) return
    setDecisions((previous) => ({ ...previous, [current.id]: decision }))
    setEntryOpen(false)
    setEntry('')
  }

  async function keepEntry() {
    if (!current || busy) return
    setBusy(true)
    try {
      if (entry.trim()) await actions.addNote(current.id, entry.trim())
      await actions.snoozeAfter(current.id, 'engaged', current.schedule.timesEngaged)
      settle('advanced')
    } finally {
      setBusy(false)
    }
  }

  async function defer(choice: DeferralChoice) {
    if (!current) return
    await actions.snooze(current.id, deferUntil(choice, new Date()))
    settle('deferred')
  }

  async function retire() {
    if (!current) return
    await actions.retire(current.id)
    settle('retired')
  }

  async function revive() {
    if (!current) return
    await actions.revive(current.id)
    settle('revived')
  }

  async function promote() {
    if (!current) return
    const result = await onPromote(
      current,
      currentRelated.map((entry_) => entry_.blip),
    )
    if (result.ok && result.path) {
      // The blip leaves the queue on success, so remember where it went — otherwise
      // the note's location vanishes with it.
      setLastNote({ title: current.title, path: result.path })
      settle('promoted')
    }
  }

  if (!current) {
    const counts = Object.values(decisions)
    const advanced = counts.filter((value) => value === 'advanced').length
    const deferred = counts.filter((value) => value === 'deferred').length
    const retired = counts.filter((value) => value === 'retired').length
    const promoted = counts.filter((value) => value === 'promoted').length
    const revived = counts.filter((value) => value === 'revived').length

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-2xl font-semibold">{done === 0 ? 'Nothing waiting' : 'Done for now'}</p>
        {done > 0 ? (
          <p className="text-sm text-ink-soft">
            {advanced} advanced · {deferred} put down · {promoted} to notes · {retired} retired
            {revived > 0 ? ` · ${revived} revived` : ''} · nothing lost.
          </p>
        ) : (
          <p className="text-sm text-ink-soft">Capture something, or look in the attic.</p>
        )}
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setDecisions({})
              setSession(null)
            }}
            className="rounded-full border border-line bg-surface px-5 py-3 text-sm font-medium"
          >
            Another round
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-surface"
          >
            Home
          </button>
        </div>
        {scope === 'today' && everything.length > today.length ? (
          <button
            type="button"
            onClick={() => setScope('all')}
            className="quiet mt-1 text-xs underline"
          >
            or review all {everything.length}
          </button>
        ) : null}
      </div>
    )
  }

  const notes = current.entries.filter((entry_) => entry_.kind === 'note')
  const images = current.entries.filter((entry_) => entry_.kind === 'media')

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center gap-2">
        {(['today', 'all'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setScope(option)}
            className={`rounded-full px-3 py-1 text-xs transition ${
              scope === option
                ? 'bg-ink font-medium text-surface'
                : 'border border-line text-ink-soft'
            }`}
          >
            {option === 'today' ? `Today · ${today.length}` : `All · ${everything.length}`}
          </button>
        ))}
        <button type="button" onClick={onBrowse} className="quiet text-xs underline">
          browse
        </button>
        <span className="ml-auto text-xs text-ink-faint">
          {done + 1} of {total}
        </span>
      </div>

      <div className="card flex flex-1 flex-col overflow-y-auto p-6">
        <div className="flex items-center gap-2 text-[11px] tracking-wide uppercase">
          <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">
            {current.type}
          </span>
          {current.schedule.timesSkipped > 0 ? (
            <span className="text-ink-faint">put down {current.schedule.timesSkipped}×</span>
          ) : null}
        </div>

        <h2 className="mt-3 text-xl leading-snug font-semibold">{current.title}</h2>
        {current.body && current.body !== current.title ? (
          <p className="mt-2 text-sm text-ink-soft">{current.body}</p>
        ) : null}
        {current.input?.url ? (
          <a
            href={current.input.url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 block truncate text-xs text-accent underline"
          >
            {current.input.url}
          </a>
        ) : null}
        {images.length > 0 ? (
          <p className="mt-2 text-xs text-ink-faint">🖼 {images.length} image attachment(s)</p>
        ) : null}
        {notes.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1">
            {notes.map((note) => (
              <li key={note.id} className="text-sm text-ink-soft">
                · {note.text}
              </li>
            ))}
          </ul>
        ) : null}

        {entryOpen ? (
          <div className="mt-5 flex flex-col gap-3">
            <textarea
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              rows={6}
              placeholder={move ? move.goal : 'What did you get?'}
              className="w-full resize-none rounded-2xl border border-line p-4 text-sm outline-none focus:border-accent"
            />
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setEntryOpen(false)} className="quiet text-xs">
                cancel
              </button>
              <button
                type="button"
                onClick={() => void keepEntry()}
                disabled={busy}
                className="ml-auto rounded-full bg-ink px-6 py-3 text-sm font-semibold text-surface disabled:opacity-40"
              >
                <ButtonLabel busy={busy}>{busy ? 'Saving…' : 'Keep it'}</ButtonLabel>
              </button>
            </div>
          </div>
        ) : move ? (
          <div
            className={`mt-5 rounded-2xl bg-accent-soft/70 p-4 transition-opacity ${
              moveLoading ? 'opacity-60' : ''
            }`}
          >
            <p className="text-[11px] tracking-wide text-accent uppercase">
              a move, if you want one
            </p>
            <p className="mt-1 text-sm font-medium">{move.title}</p>
            <p className="mt-1 text-xs text-ink-soft">goal: {move.goal}</p>
            <div className="mt-2 flex items-center gap-4 text-xs">
              <span className="text-ink-faint">
                {Math.max(1, Math.round(move.timeLimitSec / 60))} min ·{' '}
                {move.generatedBy === 'llm' ? 'adapted' : 'from the playbook'}
              </span>
              <button
                type="button"
                onClick={reroll}
                disabled={moveLoading}
                className="quiet underline disabled:no-underline disabled:opacity-60"
              >
                <ButtonLabel busy={moveLoading}>
                  {moveLoading ? 'finding another…' : 'not this one'}
                </ButtonLabel>
              </button>
            </div>

            {move.materialQuery ? (
              <div className="mt-3 rounded-xl border border-line bg-surface/60 p-3">
                {materialLoading ? (
                  <span className="flex items-center gap-2 text-xs text-ink-faint">
                    <Spinner className="h-3 w-3" />
                    finding something to read…
                  </span>
                ) : material ? (
                  <>
                    <a
                      href={material.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-xs font-medium text-accent underline"
                    >
                      {material.title}
                    </a>
                    {material.description ? (
                      <span className="text-xs text-ink-faint"> — {material.description}</span>
                    ) : null}
                    <p className="mt-1 text-xs leading-relaxed text-ink-soft">{material.extract}</p>
                  </>
                ) : (
                  <span className="text-xs text-ink-faint">
                    nothing worth reading turned up — the move works without it
                  </span>
                )}
              </div>
            ) : null}
          </div>
        ) : (
          <p className="mt-5 flex items-center gap-2 text-xs text-ink-faint">
            <Spinner className="h-3.5 w-3.5" />
            choosing a move…
          </p>
        )}

        {currentRelated.length > 0 ? (
          <div className="mt-5 border-t border-line pt-3">
            <p className="text-[11px] tracking-wide text-ink-faint uppercase">related</p>
            <ul className="mt-1 flex flex-col gap-1">
              {currentRelated.map((entry_) => (
                <li key={entry_.blip.id} className="text-xs text-ink-soft">
                  <span className="text-ink">{entry_.blip.title}</span> —{' '}
                  {entry_.reasons.join('; ')}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="mt-6 flex items-start justify-center gap-6">
        <ActionButton
          icon="↑"
          label="Promote to note"
          onClick={() => void promote()}
          busy={promotingId === current.id}
          busyLabel="writing the note…"
        />
        <ActionButton
          icon="+"
          label="Add entry"
          accent
          onClick={() => setEntryOpen((open) => !open)}
        />
        <ActionButton icon="✓" label={deferLabel} onClick={() => void defer(DEFAULT_DEFERRAL)} />
      </div>

      <div className="mt-3 flex justify-center gap-4 text-xs">
        {DEFERRAL_CHOICES.filter((choice) => choice !== DEFAULT_DEFERRAL).map((choice) => (
          <button
            key={choice}
            type="button"
            onClick={() => void defer(choice)}
            className="quiet underline"
          >
            {DEFERRAL_LABEL[choice]}
          </button>
        ))}
      </div>

      <div className="mt-4 flex justify-center gap-5 text-xs">
        {current.status === 'retired' || current.status === 'promoted' ? (
          <button type="button" onClick={() => void revive()} className="quiet underline">
            revive — put it back in play
          </button>
        ) : (
          <button type="button" onClick={() => void retire()} className="quiet underline">
            retire
          </button>
        )}
      </div>

      {current.export?.notePath ? (
        <p className="mt-2 text-center text-xs text-good">
          this one became a note: {current.export.notePath}
        </p>
      ) : null}

      {lastNote ? (
        <p className="mt-3 rounded-2xl bg-canvas p-3 text-center text-xs text-good">
          “{lastNote.title}” became a note: {lastNote.path}
        </p>
      ) : null}

      {promoteResults[current.id]?.ok === false ? (
        <p className="mt-2 text-center text-xs text-warn">
          could not write the note: {promoteResults[current.id]?.error}
        </p>
      ) : null}
    </div>
  )
}
