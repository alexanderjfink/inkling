import { BLIP_TYPES, type BlipType } from '@inkling/domain'
import { useEffect, useState } from 'react'
import type { CaptureDraft } from '../capture'
import { useSpeech } from '../state/useSpeech'

const inputClass =
  'w-full rounded-2xl border border-line bg-surface p-4 text-ink outline-none focus:border-accent'

export function Add({
  onCapture,
  initial,
  onConsumed,
  onDone,
}: {
  onCapture: (draft: CaptureDraft) => Promise<unknown>
  /** Content handed over by the OS share sheet. */
  initial?: { text?: string; url?: string } | null
  onConsumed?: () => void
  onDone: () => void
}) {
  const [text, setText] = useState(initial?.text ?? '')
  const [url, setUrl] = useState(initial?.url ?? '')
  const [file, setFile] = useState<File | undefined>()
  const [type, setType] = useState<BlipType | 'auto'>('auto')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(0)

  const speech = useSpeech((spoken) =>
    setText((current) => (current.trim() ? `${current.trim()} ${spoken}` : spoken)),
  )

  useEffect(() => {
    if (initial) onConsumed?.()
  }, [initial, onConsumed])

  const canSubmit = text.trim().length > 0 || url.trim().length > 0 || Boolean(file)

  async function submit() {
    if (!canSubmit || busy) return
    const kind: CaptureDraft['kind'] = file ? 'image' : url.trim() ? 'url' : 'text'
    setBusy(true)
    try {
      await onCapture({ kind, text, url, file, type: type === 'auto' ? undefined : type })
      setText('')
      setUrl('')
      setFile(undefined)
      setType('auto')
      setSaved((count) => count + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="What did you notice?"
        rows={6}
        className={`${inputClass} resize-none text-lg`}
      />

      <input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://  (optional)"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        className={`${inputClass} text-sm`}
      />

      <div className="flex items-center gap-3">
        <label className="flex-1 cursor-pointer rounded-2xl border border-dashed border-line bg-surface/60 px-3 py-3 text-center text-sm text-ink-soft">
          {file ? file.name : 'Add an image'}
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
          className="rounded-2xl border border-line bg-surface px-3 py-3 text-sm text-ink-soft outline-none"
        >
          <option value="auto">auto</option>
          {BLIP_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-auto flex items-center gap-3 pt-2">
        <button
          type="button"
          onClick={() => (speech.listening ? speech.stop() : speech.start())}
          disabled={!speech.supported}
          className={`circle h-[4.25rem] w-[4.25rem] ${speech.listening ? 'circle--accent' : ''}`}
          title="Ramble, and it transcribes as you talk"
        >
          <span className="text-xl">🎙</span>
        </button>
        <span className="text-xs text-ink-faint">
          {speech.listening ? 'listening — ramble away' : 'or ramble'}
        </span>

        <button
          type="button"
          onClick={() => (saved > 0 ? onDone() : submit())}
          disabled={!canSubmit || busy}
          className="ml-auto rounded-full bg-ink px-7 py-4 text-sm font-semibold text-surface disabled:opacity-40"
        >
          {busy ? 'Saving…' : saved > 0 ? 'Done' : 'Keep it'}
        </button>
      </div>

      {speech.error ? <p className="text-xs text-warn">{speech.error}</p> : null}
      <p className="text-center text-xs text-ink-faint">
        Written to this device instantly — never blocked on the network.
        {saved > 0 ? ` ${saved} captured.` : ''}
      </p>
    </div>
  )
}
