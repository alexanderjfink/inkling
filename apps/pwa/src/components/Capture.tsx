import { BLIP_TYPES, type BlipType } from '@inkling/domain'
import { useEffect, useState } from 'react'
import type { CaptureDraft } from '../capture'
import { useSpeech } from '../state/useSpeech'

export function Capture({
  onCapture,
  initial,
  onConsumed,
}: {
  onCapture: (draft: CaptureDraft) => Promise<unknown>
  /** Content handed over by the OS share sheet. */
  initial?: { text?: string; url?: string } | null
  onConsumed?: () => void
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

  // The share content has been taken into state; tell the app it can forget it.
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
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder="What did you notice?"
        rows={4}
        className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-base text-zinc-100 outline-none focus:border-zinc-600"
      />
      <input
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        placeholder="https://  (optional)"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-sm text-zinc-300 outline-none focus:border-zinc-600"
      />

      <div className="flex items-center gap-2">
        <label className="flex-1 cursor-pointer rounded-xl border border-dashed border-zinc-700 px-3 py-2 text-center text-sm text-zinc-400">
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
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-2 py-2 text-sm text-zinc-300 outline-none"
        >
          <option value="auto">auto type</option>
          {BLIP_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => (speech.listening ? speech.stop() : speech.start())}
          disabled={!speech.supported}
          className={`rounded-xl border px-3 py-3 text-sm disabled:opacity-40 ${
            speech.listening
              ? 'border-red-800 bg-red-950/40 text-red-200'
              : 'border-zinc-700 text-zinc-300'
          }`}
        >
          {speech.listening ? '◉ Stop' : '🎙 Ramble'}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || busy}
          className="flex-1 rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 disabled:opacity-40"
        >
          {busy ? 'Saving…' : 'Capture'}
        </button>
      </div>

      {speech.listening ? (
        <p className="text-center text-xs text-red-300">
          listening — ramble, and it will appear above as you talk
        </p>
      ) : null}
      {speech.error ? <p className="text-center text-xs text-amber-300">{speech.error}</p> : null}

      <p className="text-center text-xs text-zinc-500">
        Written to this device instantly — never blocked on the network.
        {saved > 0 ? ` ${saved} captured this session.` : ''}
      </p>
    </div>
  )
}
