import {
  BLIP_TYPES,
  type BlockKind,
  type Blip,
  type BlipType,
  type FeedbackContext,
  type ShareDefault,
} from '@inkling/domain'
import { useEffect, useState } from 'react'
import { type CaptureDraft, findUrl, isOnlyALink } from '../capture'
import { Feedback, type FeedbackEnv } from '../components/Feedback'
import { FriendsButton } from '../components/FriendsButton'
import { BlockPicker, BlockPreview } from '../components/Blocks'
import { ButtonLabel } from '../components/Spinner'
import type { ReceivedAsk } from '../state/useSocial'
import { useSpeech } from '../state/useSpeech'

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
  onAddBlock,
}: {
  onCapture: (draft: CaptureDraft) => Promise<{ id: string }>
  /** Attach structure to the Inkling that was just made, once it exists. */
  onAddBlock: (id: string, kind: BlockKind) => Promise<unknown>
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
  // A shared link arrives as text and an address, and they both go in the one field: a
  // shared page reads as its title, then its address, which is exactly how somebody
  // pasting it would have written it.
  const [text, setText] = useState(
    [initial?.text, initial?.url].filter((part) => part?.trim()).join('\n\n'),
  )
  /**
   * Whatever was handed over or pasted in.
   *
   * A shared link arrives as text now, with the address in it — the same thing somebody
   * typing one produces — so there is nothing separate to carry.
   */
  const [file, setFile] = useState<File | undefined>()
  const [type, setType] = useState<BlipType | 'auto'>('auto')
  /**
   * Structure chosen before there is anything to attach it to.
   *
   * A block belongs to an Inkling, and while you are writing one there is not one yet — so
   * these are the intention, applied the moment the Inkling exists. Shown while you write,
   * because a choice with no visible effect is a choice the app did not receive.
   */
  const [blocks, setBlocks] = useState<BlockKind[]>([])
  /**
   * Whether the field has been opened.
   *
   * It starts as a button saying what you might write, because that is what it is: an
   * invitation, not a form. Tapping it opens the field with the cursor in it — which is also
   * the only way a phone will raise the keyboard, since it will not do it for a focus nobody
   * asked for.
   */
  const [started, setStarted] = useState(Boolean(initial?.text || initial?.url))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(0)

  const speech = useSpeech((spoken) =>
    setText((current) => (current.trim() ? `${current.trim()} ${spoken}` : spoken)),
  )

  useEffect(() => {
    if (initial) onConsumed?.()
  }, [initial, onConsumed])

  const canSubmit = text.trim().length > 0 || Boolean(file)

  /**
   * Take an image out of a paste or a drop.
   *
   * Returns whether there was one, so the caller can leave ordinary text pasting alone.
   */
  function takeImage(data: DataTransfer | null): boolean {
    const image = [...(data?.files ?? [])].find((candidate) => candidate.type.startsWith('image/'))
    if (!image) return false
    setFile(image)
    return true
  }

  async function submit() {
    if (!canSubmit || busy) return
    // The address is found rather than asked for: one field, and a link in it is the link.
    const url = findUrl(text)
    const onlyLink = Boolean(url && isOnlyALink(text))
    const kind: CaptureDraft['kind'] = file ? 'image' : onlyLink ? 'url' : 'text'
    setBusy(true)
    try {
      const captured = await onCapture({
        kind,
        // A capture that is nothing but a link has no words of its own, so nothing is kept
        // as text: storing the address there as well would make the address the title, when
        // the site is the title. The link itself is kept, in the field for links.
        text: onlyLink ? undefined : text,
        url: url ?? undefined,
        file,
        type: type === 'auto' ? undefined : type,
        // Decided here, at the moment of writing, rather than by the fold: whether new
        // Inklings start shared is a preference, and one applied later would silently
        // re-share things written under a different one.
        visibility: socialOn && shareDefault === 'friends' ? 'friends' : undefined,
      })
      for (const kind of blocks) await onAddBlock(captured.id, kind)
      setText('')
      setFile(undefined)
      setType('auto')
      setBlocks([])
      setStarted(false)
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

      {/* One field for everything: words, a link, or a picture pasted or dropped into it.
          It used to be three — a box for the text, a box for the address, a box for the
          image — which asked you to decide what you had noticed before you had written it
          down, and made the common case (writing a sentence) look like paperwork. */}
      <div
        onDragOver={(event) => {
          // Without this the browser refuses the drop and navigates to the image instead,
          // which is a memorable way to lose a capture.
          event.preventDefault()
        }}
        onDrop={(event) => {
          if (!takeImage(event.dataTransfer)) return
          event.preventDefault()
        }}
        className="flex flex-col gap-2"
      >
        {/* One box, holding the words and the structure chosen for them. A chip under the
            field is attached to nothing in particular; a chip inside the box is part of what
            you are writing, which is what it is. */}
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 transition focus-within:border-accent">
          {started ? (
            <textarea
              ref={(node) => {
                // Focused once, when it appears, so tapping the button leaves you writing.
                if (node && document.activeElement !== node) node.focus()
              }}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onPaste={(event) => {
                // A copied image attaches; copied words paste as words, which may include a
                // link — that is found when it is kept.
                takeImage(event.clipboardData)
              }}
              onKeyDown={(event) => {
                // Cmd/Ctrl + Enter keeps it, so a desktop capture never needs the mouse.
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  void submit()
                }
              }}
              placeholder="What did you notice?"
              rows={6}
              data-tour="field"
              className="w-full resize-none bg-transparent text-lg text-ink outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setStarted(true)}
              data-tour="field"
              className="w-full py-8 text-left text-lg text-ink-faint"
            >
              What did you notice?
            </button>
          )}

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

          {/* The structure itself, not its name: a checklist you can see is a checklist,
              and "Checklist ×" told you nothing you had not just chosen. Inert here because
              there is no Inkling yet to attach it to. */}
          {blocks.map((kind) => (
            <div key={kind} className="relative">
              <BlockPreview kind={kind} />
              <button
                type="button"
                onClick={() => setBlocks((list) => list.filter((entry) => entry !== kind))}
                aria-label={`Remove the ${kind}`}
                className="quiet absolute top-2 right-2 px-1 text-xs leading-none"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </div>

      <p className="text-xs text-ink-faint">
        a photo, a link, an idea, a question, or a quest — paste one in, or just write
      </p>

      {/* Stacked, not beside the hint: side by side, the picker squeezed the sentence into
          one word a line, which is how it looked broken while it was working. */}
      <div className="self-start">
        <BlockPicker
          count={blocks.length}
          onAdd={async (kind) => setBlocks((list) => [...list, kind])}
        />
      </div>

      {/* One row, and everything in it shrinks but the two things you press: the field above
          takes the room, and this takes what is left. The label in the middle is the part
          that gives way, so "Keep it" never wraps. */}
      <div className="mt-auto flex items-center gap-2 pt-2">
        {/* The only thing left that is not the field: a way in for a picture that cannot be
            pasted, and a type you can overrule if the guess is wrong. */}
        <label className="circle h-11 w-11 shrink-0 cursor-pointer text-base" title="Add an image">
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
          {BLIP_TYPES.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => (speech.listening ? speech.stop() : speech.start())}
          disabled={!speech.supported}
          className={`circle h-12 w-12 shrink-0 ${speech.listening ? 'circle--accent' : ''}`}
          title={
            speech.supported ? 'Ramble, and it transcribes as you talk' : (speech.reason ?? '')
          }
        >
          <span>🎙</span>
        </button>
        <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">
          {!speech.supported ? 'no voice here' : speech.listening ? 'listening…' : 'or ramble'}
        </span>

        <button
          type="button"
          onClick={() => void submit()}
          disabled={!canSubmit || busy}
          className="shrink-0 rounded-full bg-ink px-5 py-3.5 text-sm font-semibold whitespace-nowrap text-surface disabled:opacity-40"
          data-tour="keep"
        >
          <ButtonLabel busy={busy}>{busy ? 'Saving…' : 'Keep it'}</ButtonLabel>
        </button>
      </div>

      {speech.error ? <p className="text-xs text-warn">{speech.error}</p> : null}

      {saved > 0 ? <p className="text-center text-xs text-ink-faint">{saved} captured.</p> : null}

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
