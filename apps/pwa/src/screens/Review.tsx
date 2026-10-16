import type {
  Blip,
  BlipType,
  DeferralChoice,
  LLMProvider,
  MoveSpec,
  RelatedBlip,
} from '@inkling/domain'
import {
  BLIP_TYPES,
  DEFERRAL_CHOICES,
  buildDailyFeed,
  buildRound,
  deferUntil,
  entryContext,
  rankBlips,
  requestGuidance,
  roundQueue,
} from '@inkling/domain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Blocks } from '../components/Blocks'
import { EntryContextPanel } from '../components/EntryContext'
import { Markdown } from '../components/Markdown'
import { ButtonLabel, Spinner } from '../components/Spinner'
import { StoredImage } from '../components/StoredImage'
import { formatDeferral, formatWhen } from '../format'
import { type LookupResult, lookupVia } from '../llm/proxy'
import type { InklingActions } from '../state/useInkling'
import type { PromoteResult } from '../state/usePromote'
import { useSuggestedMove } from '../state/useSuggestedMove'

type Decision = 'advanced' | 'deferred' | 'retired' | 'deleted' | 'promoted' | 'revived'
/** Today's finite feed, or everything you have. */
type Scope = 'today' | 'all'

const DEFAULT_DEFERRAL: DeferralChoice = 'few-days'
const DEFERRAL_LABEL: Record<DeferralChoice, string> = {
  tomorrow: 'tomorrow',
  'few-days': 'a few days',
  'next-week': 'a week',
  'next-month': 'a month',
}

/** Whatever the move turned up to read, or a word about why there is nothing. */
function Material({
  loading,
  material,
  className = 'mt-3',
}: {
  loading: boolean
  material: LookupResult | null
  className?: string
}) {
  return (
    <div className={`${className} rounded-xl border border-line bg-surface/60 p-3`}>
      {loading ? (
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
  )
}

/**
 * What to look for. Rendered wherever the move is — including inside the composer,
 * so advice you asked for is still there when you sit down to use it.
 */
function Guidance({ items, className = 'mt-3' }: { items: string[] | null; className?: string }) {
  if (!items) return null
  return (
    <div className={`${className} rounded-xl border border-line bg-surface/60 p-3`}>
      {items.length === 0 ? (
        <p className="text-xs text-ink-faint">
          nothing came back — ask again, or just start and see
        </p>
      ) : (
        <>
          <p className="text-[11px] tracking-wide text-ink-faint uppercase">what to look for</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {items.map((item) => (
              <li key={item} className="text-xs leading-relaxed text-ink-soft">
                · {item}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
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

/** The moves already put in front of you, quietly, behind a tap. */
function MoveLog({ moves }: { moves: Blip['moves'] }) {
  if (moves.length === 0) return null
  return (
    <details className="mt-5 border-t border-line pt-3">
      <summary className="cursor-pointer text-[11px] tracking-wide text-ink-faint uppercase">
        moves so far · {moves.length}
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {[...moves].reverse().map((entry) => (
          <li key={`${entry.moveId}-${entry.shownAt}`} className="text-xs text-ink-soft">
            <span className={entry.outcome === 'done' ? 'text-good' : 'text-ink-faint'}>
              {entry.outcome === 'done' ? '✓' : '·'}
            </span>{' '}
            {entry.spec.title}
            <span className="text-ink-faint">
              {' — '}
              {entry.outcome === 'done' && entry.doneAt
                ? `done ${formatWhen(entry.doneAt)}`
                : entry.outcome === 'skipped'
                  ? `put down ${formatWhen(entry.shownAt)}`
                  : `offered ${formatWhen(entry.shownAt)}`}
            </span>
          </li>
        ))}
      </ul>
    </details>
  )
}

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
  onOpenBlip,
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
  onOpenBlip: (id: string) => void
  /** An Inkling picked from the list, or from the related list, to open first. */
  focusId?: string | null
  serverUrl: string
}) {
  const [session, setSession] = useState<string[] | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [busy, setBusy] = useState(false)
  const [lastNote, setLastNote] = useState<{ title: string; path: string } | null>(null)
  const [material, setMaterial] = useState<LookupResult | null>(null)
  const [materialLoading, setMaterialLoading] = useState(false)
  /** Open when non-null. A move means "doing that move"; null means a free note. */
  const [composer, setComposer] = useState<{ move: MoveSpec | null } | null>(null)
  const [entry, setEntry] = useState('')
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftType, setDraftType] = useState<BlipType>('idea')
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  /** null means "not asked yet"; an empty list means "nothing came back". */
  const [guidance, setGuidance] = useState<string[] | null>(null)
  const [guidanceLoading, setGuidanceLoading] = useState(false)
  // A picked Inkling may not be due today, so focus starts in "all".
  const [scope, setScope] = useState<Scope>(focusId ? 'all' : 'today')

  const today = useMemo(() => buildDailyFeed(blips, { now: new Date() }), [blips])
  const everything = useMemo(() => rankBlips(blips, { now: new Date() }), [blips])
  const candidates = scope === 'today' ? today : everything
  const byId = useMemo(() => new Map(blips.map((blip) => [blip.id, blip])), [blips])

  const focus = focusId ? blips.find((blip) => blip.id === focusId) : undefined
  const focusKey = focus?.id ?? ''

  // Changing scope, or opening a different Inkling, starts a new round.
  const lastScope = useRef(scope)
  useEffect(() => {
    if (lastScope.current === scope) return
    lastScope.current = scope
    setSession(null)
    setDecisions({})
    setComposer(null)
    setLastNote(null)
  }, [scope])

  const lastFocus = useRef(focusKey)
  useEffect(() => {
    if (lastFocus.current === focusKey) return
    lastFocus.current = focusKey
    setSession(null)
    setDecisions({})
    setComposer(null)
  }, [focusKey])

  // Freeze the round when it starts, so acting on an Inkling cannot reshuffle it.
  useEffect(() => {
    if (session !== null) return
    const ordered = buildRound(candidates, byId, focusKey)
    if (ordered.length > 0) setSession(ordered)
  }, [candidates, session, focusKey, byId])

  const queue = useMemo(
    () => roundQueue(session, candidates, byId, new Set(Object.keys(decisions))),
    [session, candidates, byId, decisions],
  )
  // The round's size is frozen when it starts, not recomputed after a deletion — else
  // deleting the last Inkling in a round would read as "nothing was waiting".
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

  // Advice belongs to the move it was asked about. A different move means different
  // advice, so clear it rather than show something that no longer applies.
  const moveId = move?.id ?? ''
  useEffect(() => {
    setGuidance(null)
  }, [moveId])

  // Record what was put in front of you, so it is not offered again. Once per move
  // per Inkling, and only if the log does not already have it.
  const recorded = useRef(new Set<string>())
  useEffect(() => {
    if (!current || !move || moveLoading) return
    const key = `${current.id}:${move.id}`
    if (recorded.current.has(key)) return
    recorded.current.add(key)
    if (!current.moves.some((entry_) => entry_.moveId === move.id)) {
      void actions.recordMoveShown(current.id, move)
    }
  }, [current, move, moveLoading, actions])

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
    setComposer(null)
    setEntry('')
    setGuidance(null)
    setEditing(false)
    setConfirmingDelete(false)
  }

  async function saveForLater() {
    if (!current || !move) return
    // Keep the move, and put the Inkling down so it comes back with that move.
    await actions.saveMove(current.id, move)
    await actions.snooze(current.id, deferUntil(DEFAULT_DEFERRAL, new Date()))
    settle('deferred')
  }

  async function askForGuidance(again = false) {
    if (!current) return
    setGuidanceLoading(true)
    try {
      const result = await requestGuidance(
        {
          blip: current,
          move,
          material: material ? { title: material.title, extract: material.extract } : null,
          // Asking from inside the move: what they have started writing is context,
          // and what they already have is what not to say again.
          draft: composer?.move ? entry : undefined,
          previous: again ? (guidance ?? []) : [],
        },
        provider,
      )
      setGuidance(result?.items ?? [])
    } finally {
      setGuidanceLoading(false)
    }
  }

  async function saveEdit() {
    if (!current) return
    await actions.editBlip(current.id, {
      title: draftTitle.trim(),
      body: draftBody,
      type: draftType,
    })
    setEditing(false)
  }

  async function saveEntry() {
    if (!current || !composer || busy) return
    setBusy(true)
    try {
      if (composer.move) {
        // Keep what surrounded the answer with the answer: the move, the material it
        // turned up, and whatever "help me with the next step" suggested. None of it
        // exists anywhere else once this screen moves on.
        await actions.completeMove(
          current.id,
          composer.move,
          entry,
          entryContext({ material, guidance }),
        )
      } else {
        if (entry.trim()) await actions.addNote(current.id, entry.trim())
        await actions.snoozeAfter(current.id, 'engaged', current.schedule.timesEngaged)
      }
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

  /** Deliberately not the same word as retire. This one leaves the app. */
  async function remove() {
    if (!current) return
    await actions.deleteBlip(current.id)
    settle('deleted')
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
      // The Inkling leaves the queue on success, so remember where it went.
      setLastNote({ title: current.title, path: result.path })
      settle('promoted')
    }
  }

  if (!current) {
    const counts = Object.values(decisions)
    const advanced = counts.filter((value) => value === 'advanced').length
    const deferred = counts.filter((value) => value === 'deferred').length
    const retired = counts.filter((value) => value === 'retired').length
    const deleted = counts.filter((value) => value === 'deleted').length
    const promoted = counts.filter((value) => value === 'promoted').length
    const revived = counts.filter((value) => value === 'revived').length

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-2xl font-semibold">{done === 0 ? 'Nothing waiting' : 'Done for now'}</p>
        {done > 0 ? (
          <p className="text-sm text-ink-soft">
            {advanced} advanced · {deferred} put down · {promoted} to notes · {retired} retired
            {deleted > 0 ? ` · ${deleted} deleted` : ''}
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
  /** The move that prompted an entry, from the one place a move spec lives. */
  const moveForEntry = (moveId?: string): MoveSpec | undefined =>
    moveId ? current.moves.find((entry_) => entry_.moveId === moveId)?.spec : undefined

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
          <button
            type="button"
            onClick={() => {
              setDraftTitle(current.title)
              setDraftBody(current.body)
              setDraftType(current.type)
              setEditing(true)
            }}
            className="quiet ml-auto text-[11px] underline"
          >
            edit
          </button>
        </div>

        {editing ? (
          <div className="mt-3 flex flex-col gap-2">
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              className="w-full rounded-xl border border-line bg-surface p-3 text-base font-semibold outline-none focus:border-accent"
            />
            <textarea
              value={draftBody}
              onChange={(event) => setDraftBody(event.target.value)}
              rows={5}
              className="w-full resize-none rounded-xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
            />
            {/* A blip that started as a question often turns out to be something else. */}
            <div className="flex flex-wrap gap-1.5">
              {BLIP_TYPES.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDraftType(option)}
                  className={`rounded-full px-2.5 py-1 text-[11px] capitalize ${
                    draftType === option
                      ? 'bg-accent text-surface'
                      : 'border border-line text-ink-faint'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setEditing(false)} className="quiet text-xs">
                cancel
              </button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                className="ml-auto rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <>
            <Markdown text={current.title} className="mt-3 text-xl leading-snug font-semibold" />
            {current.body && current.body !== current.title ? (
              <Markdown text={current.body} className="mt-2 text-sm text-ink-soft" />
            ) : null}
          </>
        )}

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
          <ul className="mt-3 flex flex-wrap gap-2">
            {images.map((image) => (
              <li key={image.id}>
                {image.mediaId ? (
                  <StoredImage
                    hash={image.mediaId}
                    className="h-28 w-28 rounded-xl border border-line object-cover"
                  />
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
        {notes.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-2">
            {notes.map((note) => (
              <li key={note.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Markdown text={note.text ?? ''} className="text-sm text-ink-soft" />
                  <EntryContextPanel entry={note} move={moveForEntry(note.moveId)} />
                </div>
                <button
                  type="button"
                  onClick={() => void actions.removeEntry(current.id, note.id)}
                  aria-label="Remove this entry"
                  className="quiet px-1 text-xs leading-none"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <Blocks blip={current} actions={actions} />

        {composer ? (
          <div className="mt-5 flex flex-col gap-3">
            {composer.move ? (
              <p className="text-[11px] tracking-wide text-accent uppercase">
                doing: {composer.move.title}
              </p>
            ) : null}
            {/* What the move turned up, and anything the app suggested, stay here
                while you write — that is the whole point of having asked. */}
            {composer.move && move?.materialQuery ? (
              <Material loading={materialLoading} material={material} className="" />
            ) : null}
            <textarea
              value={entry}
              onChange={(event) => setEntry(event.target.value)}
              rows={6}
              placeholder={composer.move ? composer.move.goal : 'What did you get?'}
              className="w-full resize-none rounded-2xl border border-line p-4 text-sm outline-none focus:border-accent"
            />
            {composer.move ? (
              <div className="flex flex-wrap items-center gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => void askForGuidance(true)}
                  disabled={guidanceLoading}
                  className="quiet underline disabled:no-underline disabled:opacity-60"
                >
                  <ButtonLabel busy={guidanceLoading}>
                    {guidanceLoading
                      ? 'thinking…'
                      : guidance
                        ? 'help me further'
                        : 'help me with this'}
                  </ButtonLabel>
                </button>
              </div>
            ) : null}
            <Guidance items={guidance} className="" />
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setComposer(null)} className="quiet text-xs">
                cancel
              </button>
              <button
                type="button"
                onClick={() => void saveEntry()}
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
            {current.savedMove ? (
              <p className="mt-1 text-[11px] text-good">saved — this is the move you kept</p>
            ) : null}

            {move.materialQuery ? <Material loading={materialLoading} material={material} /> : null}

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => setComposer({ move })}
                disabled={moveLoading}
                className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-40"
              >
                Do this
              </button>
              <span className="text-xs text-ink-faint">
                {Math.max(1, Math.round(move.timeLimitSec / 60))} min ·{' '}
                {move.generatedBy === 'llm' ? 'adapted' : 'from the playbook'}
              </span>
              <button
                type="button"
                onClick={reroll}
                disabled={moveLoading}
                className="quiet ml-auto underline disabled:no-underline disabled:opacity-60"
              >
                <ButtonLabel busy={moveLoading}>
                  {moveLoading ? 'finding another…' : 'not this one'}
                </ButtonLabel>
              </button>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
              <button type="button" onClick={() => void saveForLater()} className="quiet underline">
                save for later
              </button>
              <button
                type="button"
                onClick={() => void askForGuidance()}
                disabled={guidanceLoading}
                className="quiet underline disabled:no-underline disabled:opacity-60"
              >
                <ButtonLabel busy={guidanceLoading}>
                  {guidanceLoading ? 'thinking…' : 'help me with the next step'}
                </ButtonLabel>
              </button>
            </div>

            <Guidance items={guidance} />
          </div>
        ) : (
          <p className="mt-5 flex items-center gap-2 text-xs text-ink-faint">
            <Spinner className="h-3.5 w-3.5" />
            choosing a move…
          </p>
        )}

        <MoveLog moves={current.moves} />

        {currentRelated.length > 0 ? (
          <div className="mt-5 border-t border-line pt-3">
            <p className="text-[11px] tracking-wide text-ink-faint uppercase">related</p>
            <ul className="mt-1 flex flex-col gap-1">
              {currentRelated.map((entry_) => (
                <li key={entry_.blip.id}>
                  <button
                    type="button"
                    onClick={() => onOpenBlip(entry_.blip.id)}
                    className="text-left text-xs text-ink-soft"
                  >
                    <span className="text-ink underline decoration-dotted">
                      {entry_.blip.title}
                    </span>{' '}
                    — {entry_.reasons.join('; ')}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {current.export?.notePath ? (
          <p className="mt-4 text-xs text-good">
            this one became a note: {current.export.notePath}
          </p>
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
          onClick={() => setComposer({ move: null })}
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
        {confirmingDelete ? (
          <>
            <span className="text-ink-faint">delete for good?</span>
            <button
              type="button"
              onClick={() => void remove()}
              className="font-medium text-warn underline"
            >
              yes, delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(false)}
              className="quiet underline"
            >
              keep it
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(true)}
            className="quiet underline"
          >
            delete
          </button>
        )}
      </div>

      {confirmingDelete ? (
        <p className="mt-2 text-center text-[11px] text-ink-faint">
          retire means “not now” — it goes to the attic and can come back. delete means “not this”:
          it leaves the app. Neither is a hard erase from the log.
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
