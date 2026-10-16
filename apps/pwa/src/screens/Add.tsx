import {
  BLIP_TYPES,
  type Blip,
  type BlipType,
  type FeedbackContext,
  type ShareDefault,
} from '@inkling/domain'
import { useEffect, useState } from 'react'
import type { CaptureDraft } from '../capture'
import { Feedback, type FeedbackEnv } from '../components/Feedback'
import { FriendsButton } from '../components/FriendsButton'
import { ButtonLabel } from '../components/Spinner'
import type { ReceivedAsk } from '../state/useSocial'
import { useSpeech } from '../state/useSpeech'

const inputClass =
  'w-full rounded-2xl border border-line bg-surface p-4 text-ink outline-none focus:border-accent'

/**
 * The screen the app opens on.
 *
 * Not a menu: the assumption is that you opened it because you noticed something, so the
 * cursor is in the field and you can start typing. Review is the other thing you might
 * have come to do, so it sits above the field — where the keyboard cannot cover it — with
 * a preview of what is waiting, rather than being a destination you have to remember.
 */
export function Add({
  onCapture,
  initial,
  onConsumed,
  waiting,
  next,
  total,
  attic,
  capturedToday,
  serverWarning,
  onReview,
  onAttic,
  onSettings,
  onHelp,
  feedbackEnv,
  onFeedback,
  socialOn,
  shareDefault,
  asking,
  onFriends,
  onNotifications,
  friendsWaiting,
}: {
  onCapture: (draft: CaptureDraft) => Promise<unknown>
  /** Content handed over by the OS share sheet. */
  initial?: { text?: string; url?: string } | null
  onConsumed?: () => void
  waiting: number
  /** The first Inkling up for review, shown as the preview. */
  next?: Blip | null
  total: number
  attic: number
  capturedToday: number
  serverWarning: string | null
  onReview: () => void
  onAttic: () => void
  onSettings: () => void
  onHelp: () => void
  feedbackEnv: FeedbackEnv
  onFeedback: (text: string, context: FeedbackContext) => Promise<unknown>
  socialOn: boolean
  shareDefault: ShareDefault
  /** Asks from friends, so the entry screen can say somebody is waiting. */
  asking: ReceivedAsk[]
  onFriends: () => void
  onNotifications: () => void
  /** Friends waiting on something from you, shown on the button. */
  friendsWaiting: number
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
      await onCapture({
        kind,
        text,
        url,
        file,
        type: type === 'auto' ? undefined : type,
        // Decided here, at the moment of writing, rather than by the fold: whether new
        // Inklings start shared is a preference, and one applied later would silently
        // re-share things written under a different one.
        visibility: socialOn && shareDefault === 'friends' ? 'friends' : undefined,
      })
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
      <div className="mb-1 flex items-center gap-3">
        <img src="/icon-192.png" alt="" width={36} height={36} className="h-9 w-9 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-base leading-tight font-semibold">Inkling</p>
          <p className="text-[11px] text-ink-faint">Make Moves on your Inklings</p>
        </div>
        <span data-tour="friends">
          <FriendsButton count={friendsWaiting} onClick={onFriends} />
        </span>
        <button
          type="button"
          onClick={onHelp}
          aria-label="Help"
          className="circle h-10 w-10 text-base"
        >
          ?
        </button>
        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          className="circle h-10 w-10 text-lg"
          data-tour="settings"
        >
          ⚙
        </button>
      </div>

      {/* Above the field on purpose: with the keyboard up, anything below it is gone. */}
      {socialOn && asking.length > 0 ? (
        <button
          type="button"
          onClick={onNotifications}
          className="card flex items-center gap-3 border border-accent/40 p-4 text-left transition active:scale-[0.99]"
        >
          <span className="circle h-10 w-10 shrink-0 text-lg leading-none">✎</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">
              {asking.length === 1
                ? `${asking[0]?.username} asked for a move`
                : `${asking.length} friends asked for a move`}
            </span>
            <span className="block truncate text-xs text-ink-soft">{asking[0]?.context.title}</span>
          </span>
        </button>
      ) : null}

      {waiting > 0 ? (
        <button
          type="button"
          onClick={onReview}
          className="card flex items-center gap-3 p-4 text-left transition active:scale-[0.99]"
          data-tour="review"
        >
          <span className="circle circle--accent h-10 w-10 shrink-0 text-lg leading-none">◷</span>
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold">Review · {waiting} waiting</span>
            {next ? (
              <span className="block truncate text-xs text-ink-soft">{next.title}</span>
            ) : null}
          </span>
        </button>
      ) : null}

      {serverWarning ? (
        <button
          type="button"
          onClick={onSettings}
          className="rounded-2xl border border-line bg-surface/70 p-3 text-left text-xs text-warn"
        >
          ⚠ {serverWarning} — tap to fix
        </button>
      ) : null}

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          // Cmd/Ctrl + Enter keeps it, so a desktop capture never needs the mouse.
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void submit()
          }
        }}
        // The cursor is here when the app opens, because that is what you came to do.
        // Mobile browsers only raise the keyboard for a focus they trust, so on a phone
        // this may leave the field ready without the keyboard until you tap it.
        autoFocus
        placeholder="What did you notice?"
        rows={6}
        data-tour="field"
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
          title={
            speech.supported ? 'Ramble, and it transcribes as you talk' : (speech.reason ?? '')
          }
        >
          <span className="text-xl">🎙</span>
        </button>
        <span className="text-xs text-ink-faint">
          {!speech.supported
            ? 'voice unavailable here'
            : speech.listening
              ? 'listening — ramble away'
              : 'or ramble'}
        </span>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit || busy}
          className="ml-auto rounded-full bg-ink px-7 py-4 text-sm font-semibold text-surface disabled:opacity-40"
          data-tour="keep"
        >
          <ButtonLabel busy={busy}>{busy ? 'Saving…' : 'Keep it'}</ButtonLabel>
        </button>
      </div>

      {!speech.supported && speech.reason ? (
        <p className="text-xs text-ink-faint">{speech.reason}</p>
      ) : null}
      {speech.error ? <p className="text-xs text-warn">{speech.error}</p> : null}

      <p className="text-center text-xs text-ink-faint">
        Written to this device instantly — never blocked on the network.
        {saved > 0 ? ` ${saved} captured.` : ''}
        <span className="hidden sm:inline"> ⌘↵ or Ctrl+↵ to keep it.</span>
      </p>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
        {capturedToday > 0 ? (
          <span className="text-ink-faint">{capturedToday} captured today — all saved</span>
        ) : null}
        <Feedback
          env={feedbackEnv}
          screen="entry"
          onSend={onFeedback}
          className="text-xs text-ink-faint"
        />

        <button
          type="button"
          onClick={onAttic}
          disabled={total === 0}
          className="quiet underline disabled:no-underline disabled:opacity-50"
        >
          {total === 0
            ? 'no Inklings yet'
            : `all ${total} Inkling${total === 1 ? '' : 's'}${attic > 0 ? ` · ${attic} in the attic` : ''}`}
        </button>
      </div>
    </div>
  )
}
