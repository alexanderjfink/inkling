import type { Blip, FeedbackContext, MoveSpec } from '@inkling/domain'
import { useState } from 'react'
import { ButtonLabel } from './Spinner'

/** Everything about the app itself that a report needs and the person should not have to type. */
export interface FeedbackEnv {
  app: string
  server: string
  provider?: string
  model?: string
  inklings: number
  events: number
  today: number
}

/**
 * Say something about the app.
 *
 * Reachable from the screens where friction actually happens rather than only from
 * Settings, because "where were you when it went wrong" is the first question about any
 * report — and answering it by having been in Settings is not an answer.
 *
 * The context is gathered automatically and shown back before sending. Not as a
 * formality: a report box that silently attaches information about you is a box people
 * stop using, and the whole value here is that people keep using it.
 */
export function Feedback({
  env,
  screen,
  blip,
  move,
  onSend,
  className = '',
}: {
  env: FeedbackEnv
  screen: string
  blip?: Blip
  move?: MoveSpec | null
  onSend: (text: string, context: FeedbackContext) => Promise<unknown>
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)

  const context: FeedbackContext = {
    screen,
    blip: blip
      ? {
          id: blip.id,
          type: blip.type,
          title: blip.title,
          topics: blip.topics,
          entries: blip.entries.length,
        }
      : undefined,
    move: move ? { id: move.id, title: move.title, generatedBy: move.generatedBy } : undefined,
    provider: env.provider,
    model: env.model,
    app: env.app,
    server: env.server,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    userAgent: navigator.userAgent,
    counts: { inklings: env.inklings, events: env.events, today: env.today },
  }

  async function send() {
    const said = text.trim()
    if (!said || busy) return
    setBusy(true)
    try {
      await onSend(said, context)
      setText('')
      setOpen(false)
      setSent(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <span className={`inline-flex items-center gap-2 ${className}`}>
        <button
          type="button"
          onClick={() => {
            setSent(false)
            setOpen(true)
          }}
          className="quiet underline"
        >
          feedback
        </button>
        {sent ? <span className="text-good">thank you — kept</span> : null}
      </span>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/60 p-3 sm:items-center sm:justify-center">
          <div className="card flex w-full max-w-lg flex-col gap-3 p-4">
            <div className="flex items-center">
              <p className="text-sm font-semibold">Something wrong, or something missing?</p>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="quiet ml-auto text-xs underline"
              >
                cancel
              </button>
            </div>

            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void send()
                }
              }}
              rows={4}
              autoFocus
              placeholder="In your own words. What happened, and what you expected instead."
              className="w-full resize-none rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
            />

            <details className="text-xs text-ink-faint">
              <summary className="cursor-pointer">what gets sent with it</summary>
              <pre className="mt-1.5 max-h-40 overflow-auto rounded-xl border border-line bg-surface p-2 text-xs whitespace-pre-wrap">
                {JSON.stringify(context, null, 2)}
              </pre>
              <p className="mt-1.5">
                Gathered automatically so the report can be acted on. Your Inkling's text is not
                included — only its title, so it can be recognised.
              </p>
            </details>

            <div className="flex items-center gap-3">
              <span className="text-xs text-ink-faint">⌘↵ or Ctrl+↵ to send</span>
              <button
                type="button"
                onClick={() => void send()}
                disabled={!text.trim() || busy}
                className="ml-auto rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-surface disabled:opacity-40"
              >
                <ButtonLabel busy={busy}>{busy ? 'Sending…' : 'Send'}</ButtonLabel>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
