import type { AskContext, MoveSpec } from '@inkling/domain'
import { useState } from 'react'
import { ButtonLabel } from './Spinner'

const field =
  'w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent'

/**
 * Suggesting a move for somebody else's Inkling.
 *
 * Deliberately the same fields a move has always had — a title, a goal, and how long it
 * takes — because a friend is making the same kind of thing a playbook or a model makes, and
 * it should feel like the same kind of thing. Nothing else: "something to look up" was a
 * fourth box that asked a person to do the searching half of the job the app does for a
 * generated move, and nobody filled it in.
 *
 * It lives here rather than inside the notifications screen because it is now reachable from
 * two places — answering somebody who asked, and suggesting something unprompted after
 * looking at what they have been noticing — and two copies of a form is two places for the
 * same bug.
 */
export function Suggest({
  context,
  onSend,
  onCancel,
}: {
  context: AskContext
  onSend: (move: MoveSpec, note: string) => Promise<string | null>
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [minutes, setMinutes] = useState('5')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const ready = title.trim().length > 0 && goal.trim().length > 0

  async function send() {
    if (!ready || busy) return
    setBusy(true)
    setProblem(null)
    try {
      const seconds = Math.max(1, Math.min(15, Number(minutes) || 5)) * 60
      const problemText = await onSend(
        {
          id: 'friend.suggested',
          title: title.trim(),
          why: 'because a friend thought of it',
          timeLimitSec: seconds,
          goal: goal.trim(),
          playbook: 'friend',
          generatedBy: 'friend',
        },
        note.trim(),
      )
      if (problemText) setProblem(problemText)
      else onCancel()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-line bg-surface/40 p-3">
      <p className="text-xs tracking-wide text-ink-faint uppercase">suggest a move</p>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="what should they do? e.g. Play one chord badly, twice"
        className={field}
      />
      <input
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        placeholder="what does done look like? e.g. one chord, both times"
        className={field}
      />
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="anything you want to say with it (optional)"
        className={field}
      />
      {problem ? <p className="text-xs text-warn">{problem}</p> : null}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          minutes
          <input
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            inputMode="numeric"
            className="w-16 rounded-xl border border-line bg-surface p-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <button type="button" onClick={onCancel} className="quiet ml-auto text-xs underline">
          cancel
        </button>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void send()}
          className="shrink-0 rounded-full bg-ink px-4 py-2.5 text-xs font-semibold whitespace-nowrap text-surface disabled:opacity-40"
        >
          <ButtonLabel busy={busy}>{busy ? 'Sending…' : 'Send it'}</ButtonLabel>
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        It arrives on “{context.title}” as coming from you, and pops to the top of their stack until
        they have done something with it.
      </p>
    </div>
  )
}
