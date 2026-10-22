import type { AskContext, MoveSpec } from '@inkling/domain'
import { useState } from 'react'
import { ButtonLabel } from './Spinner'

/**
 * Suggesting a move for somebody else's Inkling.
 *
 * The same shape as the box you write a move of your own in: one field to write in, the
 * awkward bits in a row underneath, and the send on the right. It used to be three small
 * inputs stacked with placeholders — which is a form, and a form asks you to think about a
 * move in fields rather than in sentences.
 *
 * The first line is the move and the rest is what done looks like, which is the same rule the
 * app uses for naming an Inkling from what you wrote. A one-line suggestion works too: the
 * line becomes both.
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
  const [text, setText] = useState('')
  const [minutes, setMinutes] = useState('5')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  const title = lines[0] ?? ''
  const goal = lines.slice(1).join(' ') || title
  const ready = title.length > 0

  async function send() {
    if (!ready || busy) return
    setBusy(true)
    setProblem(null)
    try {
      const seconds = Math.max(1, Math.min(15, Number(minutes) || 5)) * 60
      const problemText = await onSend(
        {
          id: 'friend.suggested',
          title: title.slice(0, 120),
          why: 'because a friend thought of it',
          timeLimitSec: seconds,
          goal: goal.slice(0, 200),
          playbook: 'friend',
          generatedBy: 'friend',
        },
        '',
      )
      if (problemText) setProblem(problemText)
      else onCancel()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        autoFocus
        placeholder={'what should they do?\nthe rest is what done looks like'}
        className="w-full resize-none rounded-2xl border border-line p-4 text-sm outline-none focus:border-accent"
      />
      <p className="text-xs text-ink-faint">
        {lines.length > 1
          ? `“${title}” — done when: ${goal}`
          : 'first line is the move; a second line says what done looks like'}
      </p>
      {problem ? <p className="text-xs text-warn">{problem}</p> : null}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onCancel} className="quiet text-xs underline">
          cancel
        </button>
        <label className="ml-auto flex items-center gap-2 text-xs text-ink-soft">
          minutes
          <input
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            inputMode="numeric"
            className="w-16 rounded-xl border border-line bg-surface p-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void send()}
          className="shrink-0 rounded-full bg-ink px-5 py-2.5 text-xs font-semibold whitespace-nowrap text-surface disabled:opacity-40"
        >
          <ButtonLabel busy={busy}>{busy ? 'Sending…' : 'Send the move'}</ButtonLabel>
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        It arrives on “{context.title}” as coming from you, and pops to the top of their stack until
        they have done something with it.
      </p>
    </div>
  )
}
