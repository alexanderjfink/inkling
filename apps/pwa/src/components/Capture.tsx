import { BLIP_TYPES, type BlipType } from '@inkling/domain'
import { useState } from 'react'
import type { CaptureDraft } from '../capture'

export function Capture({ onCapture }: { onCapture: (draft: CaptureDraft) => Promise<unknown> }) {
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [file, setFile] = useState<File | undefined>()
  const [type, setType] = useState<BlipType | 'auto'>('auto')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(0)

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
      setSaved((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="What did you notice?"
        rows={4}
        className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-900/60 p-3 text-base text-zinc-100 outline-none focus:border-zinc-600"
      />
      <input
        value={url}
        onChange={(e) => setUrl(e.target.value)}
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
            onChange={(e) => setFile(e.target.files?.[0] ?? undefined)}
          />
        </label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as BlipType | 'auto')}
          className="rounded-xl border border-zinc-800 bg-zinc-900/60 px-2 py-2 text-sm text-zinc-300 outline-none"
        >
          <option value="auto">auto type</option>
          {BLIP_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>
      <button
        type="button"
        onClick={submit}
        disabled={!canSubmit || busy}
        className="rounded-xl bg-zinc-100 px-4 py-3 text-sm font-semibold text-zinc-900 disabled:opacity-40"
      >
        {busy ? 'Saving…' : 'Capture'}
      </button>
      <p className="text-center text-xs text-zinc-500">
        Written to this device instantly — never blocked on the network.
        {saved > 0 ? ` ${saved} captured this session.` : ''}
      </p>
    </div>
  )
}
