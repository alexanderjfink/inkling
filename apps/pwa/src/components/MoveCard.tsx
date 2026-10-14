import type { Blip, LLMProvider, MoveContext, MoveSpec, SelectMoveOptions } from '@inkling/domain'
import { selectMove } from '@inkling/domain'
import { useEffect, useState } from 'react'
import type { InklingActions } from '../state/useInkling'

function clock(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

const SOURCE_LABEL: Record<string, string> = {
  llm: 'adapted by the model',
  playbook: 'from the playbook',
}

/**
 * In-flight requests, shared across mounts.
 *
 * React StrictMode mounts effects twice in development. Without this, the first
 * run's cleanup cancels its request and the second run starts another one, so the
 * result is thrown away — and the card sits on "choosing a move…" forever. Sharing
 * one promise per key means both runs get the same answer and the model is asked
 * exactly once.
 */
const pending = new Map<string, Promise<MoveSpec>>()

function requestMove(
  key: string,
  context: MoveContext,
  options: SelectMoveOptions,
): Promise<MoveSpec> {
  const existing = pending.get(key)
  if (existing) return existing
  const promise = selectMove(context, options).finally(() => pending.delete(key))
  pending.set(key, promise)
  return promise
}

/**
 * One suggested move, presented as a small commitment: read it, start the timer,
 * do the thing, keep the result. "Not this one" re-rolls rather than dismissing,
 * because the point is to make progress, not to get out of it.
 */
export function MoveCard({
  blip,
  related,
  provider,
  actions,
  onComplete,
}: {
  blip: Blip
  related: Blip[]
  provider: LLMProvider
  actions: InklingActions
  onComplete: () => void
}) {
  const [move, setMove] = useState<MoveSpec | null>(null)
  const [avoid, setAvoid] = useState<string[]>([])
  const [started, setStarted] = useState(false)
  const [remaining, setRemaining] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  // Deps are primitives on purpose: `related` is a fresh array each render, and
  // depending on it would re-request the move on every render.
  const relatedIds = related.map((other) => other.id).join(',')
  const key = `${blip.id}:${avoid.join(',')}`

  useEffect(() => {
    let cancelled = false
    const seen = [...blip.moves.map((entry) => entry.moveId), ...avoid]
    void requestMove(key, { blip, related, seenMoveIds: seen }, { provider, related }).then(
      (spec) => {
        if (cancelled) return
        setMove(spec)
        setRemaining(spec.timeLimitSec)
      },
    )
    return () => {
      cancelled = true
    }
    // eslint-style note: `related` and `avoid` are covered by relatedIds/key.
  }, [key, relatedIds, provider, blip])

  useEffect(() => {
    if (!started || remaining <= 0) return
    const timer = setInterval(() => setRemaining((value) => Math.max(0, value - 1)), 1000)
    return () => clearInterval(timer)
  }, [started, remaining])

  async function start() {
    if (!move) return
    setStarted(true)
    await actions.recordMoveShown(blip.id, move)
  }

  async function save() {
    if (!move || busy) return
    setBusy(true)
    try {
      await actions.completeMove(blip.id, move.id, text)
      onComplete()
    } finally {
      setBusy(false)
    }
  }

  if (!move) {
    return (
      <div className="mt-3 rounded-xl border border-dashed border-zinc-800 p-3 text-xs text-zinc-500">
        choosing a move…
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="mb-1 flex flex-wrap items-center gap-2 text-[10px] tracking-wide text-zinc-500 uppercase">
        <span className="rounded-full bg-zinc-800 px-2 py-0.5">move</span>
        <span>{clock(move.timeLimitSec)}</span>
        <span>{SOURCE_LABEL[move.generatedBy] ?? move.generatedBy}</span>
      </div>

      <p className="text-sm font-medium text-zinc-100">{move.title}</p>
      <p className="mt-1 text-xs text-zinc-400">{move.why}</p>
      <p className="mt-2 text-xs text-zinc-500">
        goal: <span className="text-zinc-300">{move.goal}</span>
      </p>

      {move.steps && move.steps.length > 0 ? (
        <ol className="mt-2 flex list-decimal flex-col gap-0.5 pl-4 text-xs text-zinc-400">
          {move.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      ) : null}

      {!started ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={() => void start()}
            className="rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900"
          >
            Start {clock(move.timeLimitSec)}
          </button>
          <button
            type="button"
            onClick={() => {
              setAvoid((current) => [...current, move.id])
              setMove(null)
              setStarted(false)
            }}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-400"
          >
            Not this one
          </button>
        </div>
      ) : (
        <div className="mt-3 flex flex-col gap-2">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-mono text-base text-zinc-100">{clock(remaining)}</span>
            <span className="text-zinc-500">
              {remaining === 0 ? 'time is up — keep whatever you have' : 'running'}
            </span>
          </div>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={3}
            placeholder="What did you get?"
            className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950/60 p-3 text-sm text-zinc-100 outline-none focus:border-zinc-600"
          />
          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="self-end rounded-lg bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-900 disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Keep it & move on'}
          </button>
        </div>
      )}
    </div>
  )
}
