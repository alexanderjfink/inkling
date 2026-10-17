import { ButtonLabel } from './Spinner'

/**
 * A question in the middle of the screen, with two answers you cannot miss.
 *
 * Retiring and deleting were a word in the footer and, for deleting, a second word beside it
 * — the same size as everything else in a row of small underlined links, one of which throws
 * the Inkling away. Asking properly costs a tap and buys the only thing that matters here:
 * that the answer was meant. So the question is large, both buttons are large, and the one
 * that does the thing is not the one your thumb is already on.
 */
export function Confirm({
  question,
  detail,
  confirmLabel,
  cancelLabel = 'No, keep it',
  tone = 'normal',
  busy = false,
  onConfirm,
  onCancel,
}: {
  question: string
  detail?: string
  confirmLabel: string
  cancelLabel?: string
  /** `danger` for the one that cannot be undone. */
  tone?: 'normal' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-6"
      role="dialog"
      aria-modal="true"
      aria-label={question}
    >
      {/* The backdrop is a button, so the way out of a question you did not mean to ask is the
          biggest target on the screen rather than a small word. */}
      <button
        type="button"
        aria-label={cancelLabel}
        onClick={onCancel}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div className="card relative w-full max-w-sm p-5 text-center">
        <p className="text-2xl font-semibold">{question}</p>
        {detail ? <p className="mt-2 text-sm text-ink-soft">{detail}</p> : null}
        <div className="mt-6 flex flex-col gap-3">
          {/* `bg-ink` with `text-surface`, not a fixed white: the two are a pair that swaps
              over between themes, and `text-white` on `bg-ink` in the dark theme is white on
              near-white — which is what the first version of this looked like. */}
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`rounded-2xl px-6 py-4 text-base font-semibold text-surface disabled:opacity-50 ${
              tone === 'danger' ? 'bg-warn' : 'bg-ink'
            }`}
          >
            <ButtonLabel busy={busy}>{confirmLabel}</ButtonLabel>
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="rounded-2xl border border-line bg-surface px-6 py-4 text-base font-medium disabled:opacity-50"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
