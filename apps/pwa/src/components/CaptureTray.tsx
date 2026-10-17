import type { BlipType, Visibility } from '@inkling/domain'
import { useState } from 'react'
import { type CaptureDraft, findUrl, isOnlyALink, takeImageFrom } from '../capture'
import { ButtonLabel } from './Spinner'

/**
 * Catching something wherever you are.
 *
 * A tray that comes up from the bottom over whatever you were looking at, because noticing
 * something happens while you are reading something else. It was the + on the home screen and
 * only there, which meant the rhythm was: leave what you were doing, go home, capture, come
 * back — and most people, most of the time, do not.
 *
 * The same field as the home screen, doing the same things: words, a link, or a picture pasted
 * or dropped in. One rule, one place, so a capture cannot behave differently depending on where
 * you happened to be standing.
 */
export function CaptureTray({
  onCapture,
  onClose,
  shareDefault,
  socialOn,
}: {
  onCapture: (draft: CaptureDraft) => Promise<unknown>
  onClose: () => void
  shareDefault: 'private' | 'friends'
  socialOn: boolean
}) {
  const [text, setText] = useState('')
  const [file, setFile] = useState<File | undefined>(undefined)
  const [type, setType] = useState<BlipType | 'auto'>('auto')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const canKeep = text.trim().length > 0 || Boolean(file)

  async function keep() {
    if (!canKeep || busy) return
    setBusy(true)
    setProblem(null)
    try {
      const url = findUrl(text)
      const onlyLink = Boolean(url && isOnlyALink(text))
      await onCapture({
        kind: file ? 'image' : onlyLink ? 'url' : 'text',
        text: onlyLink ? undefined : text,
        url: url ?? undefined,
        file,
        type: type === 'auto' ? undefined : type,
        visibility: (socialOn && shareDefault === 'friends' ? 'friends' : undefined) as
          | Visibility
          | undefined,
      })
      onClose()
    } catch {
      setProblem('that did not save — try again')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div className="tray-in relative mx-auto flex w-full max-w-xl flex-col gap-3 rounded-t-3xl border border-line bg-surface p-4 pb-6 shadow-card">
        <div className="flex items-center gap-3">
          <span
            className="circle h-9 w-9 shrink-0 text-base leading-none text-surface"
            style={{ background: 'var(--color-good)' }}
          >
            ✎
          </span>
          <span className="text-sm font-semibold">What did you notice?</span>
          <button type="button" onClick={onClose} className="quiet ml-auto text-xs underline">
            close
          </button>
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          onPaste={(event) => {
            setFile(takeImageFrom(event.clipboardData) ?? file)
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              event.preventDefault()
              void keep()
            }
            if (event.key === 'Escape') onClose()
          }}
          rows={4}
          autoFocus
          placeholder="a photo, a link, an idea, a question, or a quest — paste one in, or just write"
          className="w-full resize-none rounded-2xl border border-line bg-canvas/60 p-3 text-base text-ink outline-none focus:border-accent"
        />

        {file ? (
          <span className="flex items-center gap-3 rounded-xl border border-line bg-surface/60 p-2 pl-3 text-xs">
            <span className="text-ink-soft">🖼</span>
            <span className="min-w-0 flex-1 truncate">{file.name}</span>
            <button
              type="button"
              onClick={() => setFile(undefined)}
              className="quiet underline"
              aria-label="Remove the image"
            >
              remove
            </button>
          </span>
        ) : null}

        {problem ? <p className="text-xs text-warn">{problem}</p> : null}

        <div className="flex items-center gap-2">
          <label
            className="circle h-11 w-11 shrink-0 cursor-pointer text-base"
            title="Add an image"
          >
            📎
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => setFile(event.target.files?.[0] ?? undefined)}
            />
          </label>
          <select
            value={type}
            onChange={(event) => setType(event.target.value as BlipType | 'auto')}
            aria-label="Kind of Inkling"
            className="shrink-0 rounded-2xl border border-line bg-surface px-2 py-2.5 text-xs text-ink-soft outline-none"
          >
            <option value="auto">auto</option>
            {['question', 'reference', 'insight', 'idea', 'quest', 'yearning', 'other'].map(
              (option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ),
            )}
          </select>
          <button
            type="button"
            disabled={!canKeep || busy}
            onClick={() => void keep()}
            className="ml-auto shrink-0 rounded-full bg-ink px-5 py-3 text-sm font-semibold whitespace-nowrap text-surface disabled:opacity-40"
          >
            <ButtonLabel busy={busy}>{busy ? 'Saving…' : 'Keep it'}</ButtonLabel>
          </button>
        </div>
      </div>
    </div>
  )
}
