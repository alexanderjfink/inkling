import {
  BLIP_TYPES,
  type Block,
  type Blip,
  type BlipType,
  type FeedbackContext,
  type Friend,
  newBlock,
  type ShareDefault,
} from '@inkling/domain'
import { useEffect, useRef, useState } from 'react'
import { type CaptureDraft, findUrl, isOnlyALink } from '../capture'
import { Feedback, type FeedbackEnv } from '../components/Feedback'
import { nameOf } from '@inkling/domain'
import { Avatar } from '../components/Avatar'
import { FriendsButton } from '../components/FriendsButton'
import { BlockPicker, DraftBlocks } from '../components/Blocks'
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
  serverWarning,
  onReview,
  onSettings,
  onYou,
  userId,
  username,
  userColor,
  userAvatar,
  feedbackEnv,
  onFeedback,
  socialOn,
  shareDefault,
  asking,
  friends,
  onNotifications,
  friendsWaiting,
  transcribeUrl,
  onAddBlock,
  onStoreImage,
}: {
  onCapture: (draft: CaptureDraft) => Promise<{ id: string }>
  /** Attach structure to the Inkling that was just made, once it exists. */
  onAddBlock: (id: string, block: Block) => Promise<unknown>
  /** Content handed over by the OS share sheet. */
  initial?: { text?: string; url?: string } | null
  onConsumed?: () => void
  waiting: number
  /** The first Inkling up for review, shown as the preview. */
  next?: Blip | null
  serverWarning: string | null
  onReview: () => void
  onSettings: () => void
  /** Who you are: your picture, your colour, your password. */
  onYou: () => void
  userId?: string
  username: string
  userColor?: string
  userAvatar?: string
  feedbackEnv: FeedbackEnv
  onFeedback: (text: string, context: FeedbackContext) => Promise<unknown>
  socialOn: boolean
  shareDefault: ShareDefault
  /** Asks from friends, so the entry screen can say somebody is waiting. */
  asking: ReceivedAsk[]
  /** Who your friends are, so the card below can call them by the name they chose. */
  friends: Friend[]
  onNotifications: () => void
  /** Friends waiting on something from you, shown on the button. */
  friendsWaiting: number
  /** A server that can hear, if one is set up. Null means the browser's own recogniser. */
  transcribeUrl: string | null
  /** Where a picture goes when structure asks for one before the Inkling exists. */
  onStoreImage: (file: File) => Promise<{ hash: string; mime: string }>
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
  const [blocks, setBlocks] = useState<Block[]>([])
  /**
   * Whether the field has been opened.
   *
   * It starts as a button saying what you might write, because that is what it is: an
   * invitation, not a form. Tapping it opens the field with the cursor in it — which is also
   * the only way a phone will raise the keyboard, since it will not do it for a focus nobody
   * asked for.
   */
  const [started, setStarted] = useState(Boolean(initial?.text || initial?.url))
  /** Whether that first focus has happened, so later renders leave the cursor alone. */
  const focusedOnce = useRef(false)
  /** The box and everything that belongs to it: the field, the paperclip, the type, the mic. */
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [busy, setBusy] = useState(false)

  const speech = useSpeech(
    (spoken) => setText((current) => (current.trim() ? `${current.trim()} ${spoken}` : spoken)),
    // The server's transcriber, when it has one: a recording goes up and words come back.
    // Null means the browser's own, if it has one.
    // Same prefix rule: `transcribeUrl` is already `/api`.
    { transcribeUrl: transcribeUrl ? `${transcribeUrl}/transcribe` : null },
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
      for (const block of blocks) await onAddBlock(captured.id, block)
      setText('')
      setFile(undefined)
      setType('auto')
      setBlocks([])
      setStarted(false)
      // The green tick is the confirmation now; a count that never goes down said less.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-1 flex-col gap-3">
      <div className="mb-1 flex items-center gap-2">
        <img
          src="/icon-192.png"
          alt=""
          width={36}
          height={36}
          className="h-9 w-9 shrink-0 rounded-xl"
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-base leading-tight font-semibold">Inkling</p>
        </div>
        <span data-tour="friends">
          {/* Notifications, not the list of names: it is the area's default view, and the two
              are tabs of one screen anyway. Being sent to the list of friends is what this
              button used to do, which nobody ever wanted. */}
          <FriendsButton count={friendsWaiting} onClick={onNotifications} />
        </span>
        <button
          type="button"
          onClick={onSettings}
          aria-label="Settings"
          className="circle h-10 w-10 shrink-0 text-lg"
          data-tour="settings"
        >
          ⚙
        </button>
        {/* Your own face, at the far right, because it is you. It goes to you — your picture,
            your colour, your password — which is not the same place as the app's settings, and
            used to be the fourth of four identical circles. Help moved into Settings with it:
            five did not fit on a phone, and the name was what got squeezed. */}
        <button type="button" onClick={onYou} aria-label="You" className="shrink-0">
          <Avatar
            userId={userId}
            username={username}
            color={userColor}
            hash={userAvatar}
            size={40}
          />
        </button>
      </div>

      {/* Centred as a group: what you came for is the Review card and the field, and a
            screen that starts at the top of a phone leaves them both in its upper third, with
            the keyboard covering the rest. The header stays where it is — it is the one thing
            that should not move. */}
      <div className="flex flex-1 flex-col justify-center gap-3">
        {/* The slogan has room here. In the header at 390px it truncated to "Make Moves on
            your Inkli…", which is worse than not saying it — and this is the screen it is
            about. */}
        <p className="mb-1 text-center text-sm text-ink-faint">Make Moves on your Inklings</p>
        {/* Above the field on purpose: with the keyboard up, anything below it is gone. */}
        {socialOn && asking.length > 0 ? (
          <button
            type="button"
            onClick={onNotifications}
            className="card flex items-center gap-3 border border-accent/40 p-4 text-left transition active:scale-[0.99]"
          >
            {/* A face, because it is a person asking; the ✎ is what the card below it is for. */}
            <span className="circle h-10 w-10 shrink-0 text-base leading-none">☺</span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">
                {asking.length === 1
                  ? `${asking[0] ? nameOf(friends.find((f) => f.userId === asking[0]?.userId) ?? { username: asking[0].username }) : 'somebody'} wants your help`
                  : 'Friends want your help!'}
              </span>
              <span className="block truncate text-xs text-ink-soft">
                {asking[0]?.context.title}
              </span>
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
          <div
            ref={boxRef}
            className={
              started
                ? 'flex flex-col gap-2 rounded-2xl border border-line bg-surface p-3 transition focus-within:border-accent'
                : ''
            }
          >
            {started ? (
              <textarea
                ref={(node) => {
                  // Focused **once**, when it appears. A callback ref runs on every render, so
                  // asking "is this focused" here pulled the cursor back out of whatever else
                  // you had started typing in — which made the checklist take one keystroke at
                  // a time, each one landing back up here.
                  if (node && !focusedOnce.current) {
                    focusedOnce.current = true
                    node.focus()
                  }
                }}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onPaste={(event) => {
                  // A copied image attaches; copied words paste as words, which may include a
                  // link — that is found when it is kept.
                  takeImage(event.clipboardData)
                }}
                onBlur={() => {
                  // Tapping in and then tapping away leaves the box as it was: back to the
                  // question it asks, rather than a large empty form you did not start
                  // filling in. Deferred by a moment because a blur also happens when the
                  // tap went to something that belongs to the box — the paperclip, the type,
                  // the microphone — and clearing the field then would take it away from
                  // under the tap.
                  window.setTimeout(() => {
                    if (boxRef.current?.contains(document.activeElement)) return
                    if (text.trim() || file || blocks.length > 0) return
                    setStarted(false)
                  }, 150)
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
              /* The same shape as the Review card it sits under: a card with an icon, what it
                 is for, and a line under that. It used to be a large empty box with a question
                 in it, which read as a different kind of thing from the card beside it — two
                 boxes, one of which you were supposed to understand and the other to use. */
              <button
                type="button"
                onClick={() => setStarted(true)}
                data-tour="field"
                className="card flex items-center gap-3 p-4 text-left transition active:scale-[0.99]"
              >
                {/* A different colour from the Review card above it: they are the two things you
                    came to do, and they were two grey circles with grey words under them. */}
                <span
                  className="circle h-10 w-10 shrink-0 text-base leading-none text-surface"
                  style={{ background: 'var(--color-good)' }}
                >
                  ✎
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">What’s your Inkling?</span>
                  <span className="block text-xs text-ink-soft">
                    a photo, a link, an idea, a question, or a quest — paste one in, or just write
                  </span>
                </span>
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

            {/* The structure itself, and usable: a checklist you cannot tick is a drawing of
              a checklist, and the point of adding one while you write is to put the parts
              down as you think of them. It is attached when the Inkling is made. */}
            <DraftBlocks blocks={blocks} onChange={setBlocks} onStoreImage={onStoreImage} />
          </div>
        </div>

        {started ? (
          <p className="text-xs text-ink-faint">
            a photo, a link, an idea, a question, or a quest — paste one in, or just write
          </p>
        ) : null}

        {/* Stacked, not beside the hint: side by side, the picker squeezed the sentence into
          one word a line, which is how it looked broken while it was working. */}
        {/* Only once there is something to give structure to. It was there from the first
          moment, on an empty screen, asking about a shape for something that did not exist. */}
        {started ? (
          <div className="self-start">
            <BlockPicker
              count={blocks.length}
              onAdd={async (kind) => setBlocks((list) => [...list, newBlock(kind)])}
            />
          </div>
        ) : null}

        {/* Kept and attached: everything that acts on what you have written appears with the
            field rather than before it, so the screen you land on is one card and a question
            rather than a form waiting to be filled in. */}
        <div className={`flex items-center gap-2 ${started ? '' : 'hidden'}`}>
          {/* The only thing left that is not the field: a way in for a picture that cannot be
            pasted, and a type you can overrule if the guess is wrong. */}
          <label
            className="circle h-11 w-11 shrink-0 cursor-pointer text-base"
            title="Add an image"
          >
            📎
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const chosen = event.target.files?.[0]
                setFile(chosen)
                if (chosen) setStarted(true)
              }}
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
            title={speech.supported ? 'Ramble, and it transcribes as you talk' : ''}
          >
            <span>🎙</span>
          </button>
          <span className="min-w-0 flex-1 truncate text-xs text-ink-faint">
            {!speech.supported
              ? 'no mic here'
              : speech.thinking
                ? 'writing…'
                : speech.listening
                  ? 'listening…'
                  : 'ramble'}
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
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs">
        <Feedback
          env={feedbackEnv}
          screen="entry"
          onSend={onFeedback}
          className="text-xs text-ink-faint"
        />
      </div>
    </div>
  )
}
