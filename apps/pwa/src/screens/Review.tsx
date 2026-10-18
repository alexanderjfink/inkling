import type {
  Blip,
  BlipType,
  FeedbackContext,
  DeferralChoice,
  LLMProvider,
  MoveLink,
  MoveSpec,
  RejectionContext,
  RelatedBlip,
} from '@inkling/domain'
import {
  BLIP_TYPES,
  askContextFor,
  buildDailyFeed,
  buildNearFeed,
  buildRound,
  deferUntil,
  entryContext,
  rankBlips,
  newBlock,
  pendingFriendMoves,
  REJECTION_REASONS,
  requestGuidance,
  roundQueue,
} from '@inkling/domain'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { FriendFaces } from '../components/FriendFaces'
import { BlockPicker, Blocks } from '../components/Blocks'
import { Confirm } from '../components/Confirm'
import { Feedback, type FeedbackEnv } from '../components/Feedback'
import { EntryContextPanel } from '../components/EntryContext'
import { ExportNote } from '../components/ExportNote'
import { PROMOTE_ENABLED } from '../features'
import { imageFrom, isOnlyALink, findUrl } from '../capture'
import type { EntryDraft } from '../capture'
import { Markdown } from '../components/Markdown'
import { ButtonLabel, Spinner } from '../components/Spinner'
import { StoredImage } from '../components/StoredImage'
import { formatDeferral, formatShortWeekday, formatWhen } from '../format'
import { type LookupResult, lookupVia } from '../llm/proxy'
import type { InklingActions } from '../state/useInkling'
import type { PromoteResult } from '../state/usePromote'
import type { SocialState } from '../state/useSocial'
import { useSuggestedMove } from '../state/useSuggestedMove'

type Decision =
  | 'advanced'
  | 'deferred'
  | 'retired'
  | 'deleted'
  | 'promoted'
  | 'revived'
  | 'rejected'
/** Today's finite feed, or everything you have. */
type Scope = 'today' | 'near' | 'all'

const DEFAULT_DEFERRAL: DeferralChoice = 'few-days'

/**
 * Where this move sends you.
 *
 * The whole list at once, and each one says what it is: a page the server found and
 * checked, or a search for a phrase. A search link is not a failure — "best starter MIDI
 * keyboard" is not an encyclopaedia article and should not be — and saying which is which
 * is the difference between a suggestion and a guess.
 */
function LookUps({ links, loading }: { links: MoveLink[]; loading: boolean }) {
  if (links.length === 0) {
    if (!loading) return null
    return (
      <span className="mt-3 flex items-center gap-2 text-xs text-ink-faint">
        <Spinner className="h-3 w-3" />
        finding somewhere to look…
      </span>
    )
  }

  return (
    <div className="mt-3 flex flex-col gap-1.5">
      <p className="text-xs tracking-wide text-ink-faint uppercase">where to look</p>
      {links.map((link) => (
        <a
          key={link.url}
          href={link.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-baseline gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs transition active:scale-[0.99]"
        >
          <span className="min-w-0 flex-1 truncate text-accent">
            {link.kind === 'search' ? `search for “${link.label}”` : link.label}
          </span>
          <span className="shrink-0 text-xs text-ink-faint">
            {link.kind === 'search' ? 'search' : 'page'}
          </span>
        </a>
      ))}
    </div>
  )
}

/**
 * A note to a friend: thanks for a move, or telling them it worked.
 *
 * One line and a send button, because a note that takes as long to write as the move did
 * is a note nobody sends.
 */
function Note({
  kind,
  username,
  moveTitle,
  busy,
  onCancel,
  onSend,
  problem,
}: {
  kind: 'kudos' | 'thanks'
  username: string
  moveTitle: string
  busy: boolean
  onCancel: () => void
  onSend: (text: string) => Promise<void>
  problem: string | null
}) {
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  /** The whole of a thank-you, most of the time. */
  const QUICK = kind === 'kudos' ? ['🎉', '💡', '👏', '🙌'] : ['🙏', '❤️', '😄', '✨']

  async function send(value: string) {
    setSending(true)
    try {
      await onSend(value)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-xs text-ink-faint">
        {kind === 'kudos'
          ? `tell ${username} the move worked`
          : `thank ${username} for “${moveTitle}”`}
      </p>
      {/* An emoji is a thank-you. Asking somebody to write a sentence in order to say "thank
          you" is how the sentence does not get written — so the four that cover almost every
          case send on the tap, and the field underneath is for the times it is more than that. */}
      <div className="flex flex-wrap items-center gap-2">
        {QUICK.map((emoji) => (
          <button
            key={emoji}
            type="button"
            disabled={busy || sending}
            onClick={() => void send(emoji)}
            className="rounded-full border border-line bg-surface px-3.5 py-2 text-lg leading-none disabled:opacity-40"
            title={`send ${emoji}`}
          >
            {emoji}
          </button>
        ))}
        <span className="text-xs text-ink-faint">or write it</span>
      </div>
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && text.trim()) void onSend(text.trim())
        }}
        autoFocus
        placeholder={kind === 'kudos' ? 'it worked, because…' : 'thank you —'}
        className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs outline-none focus:border-accent"
      />
      {problem ? <p className="text-xs text-warn">{problem}</p> : null}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onCancel} className="quiet text-xs underline">
          cancel
        </button>
        <button
          type="button"
          disabled={!text.trim() || busy || sending}
          onClick={() => {
            setSending(true)
            void onSend(text.trim()).finally(() => setSending(false))
          }}
          className="ml-auto rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-40"
        >
          <ButtonLabel busy={sending}>{sending ? 'Sending…' : 'Send'}</ButtonLabel>
        </button>
      </div>
    </div>
  )
}

/**
 * Swiping up and down between the Inklings of a round.
 *
 * Only at the ends. The card scrolls, and a round is a stack of cards you read — taking over
 * every vertical drag would make a long Inkling unreadable and a short one impossible to leave.
 * So a drag is the round's only when the card has nowhere left to scroll in that direction:
 * pulling down at the top goes back, pulling up at the bottom goes on.
 */
const ROUND_AT = 64

function useRoundSwipe({
  next,
  previous,
  hasNext,
  hasPrevious,
}: {
  next: () => void
  previous: () => void
  hasNext: boolean
  hasPrevious: boolean
}) {
  const cardRef = useRef<HTMLDivElement | null>(null)
  const [pull, setPull] = useState<'down' | 'up' | null>(null)
  const [armed, setArmed] = useState(false)
  const from = useRef<number | null>(null)
  const engaged = useRef(false)

  const atTop = () => (cardRef.current?.scrollTop ?? 0) <= 0
  const atBottom = () => {
    const element = cardRef.current
    if (!element) return false
    return element.scrollTop + element.clientHeight >= element.scrollHeight - 1
  }

  const handlers = {
    onPointerDown: (event: React.PointerEvent) => {
      // A desktop scrolls with a wheel, and a mouse drag is how you select things.
      if (event.pointerType === 'mouse') return
      from.current = event.clientY
      engaged.current = false
      setPull(null)
      setArmed(false)
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (from.current === null) return
      const delta = event.clientY - from.current
      if (Math.abs(delta) < 12) return
      const lookingBack = delta > 0 && hasPrevious && atTop()
      const lookingOn = delta < 0 && hasNext && atBottom()
      engaged.current = lookingBack || lookingOn
      setPull(engaged.current ? (lookingBack ? 'down' : 'up') : null)
      setArmed(engaged.current && Math.abs(delta) >= ROUND_AT)
    },
    onPointerUp: () => {
      if (engaged.current && armed) {
        if (pull === 'down') previous()
        else next()
      }
      from.current = null
      engaged.current = false
      setPull(null)
      setArmed(false)
    },
    onPointerCancel: () => {
      from.current = null
      engaged.current = false
      setPull(null)
      setArmed(false)
    },
  }

  return {
    cardRef,
    handlers,
    pull,
    armed,
    previous,
    next,
    showPrevious: hasPrevious,
    showNext: hasNext,
  }
}

/**
 * Dragging the move sideways, and what the two sides mean.
 *
 * On a phone the whole move is the control: tap it to do it, pull it right for what friends
 * suggested, left for what the app has. The indicator appears as soon as the drag starts — so
 * a hold in the middle shows what letting go would do, which is the whole of discoverability
 * here. Nothing happens for a drag shorter than the threshold; it springs back.
 */
const SWIPE_AT = 72
const SWIPE_TRAVEL = 460

type SwipeDirection = 'left' | 'right'

function useMoveSwipe(onSwipe: (direction: SwipeDirection) => void) {
  const [dx, setDx] = useState(0)
  const [dy, setDy] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [leaving, setLeaving] = useState<SwipeDirection | null>(null)
  const from = useRef<{ x: number; y: number } | null>(null)
  /** Whether this gesture turned into a drag, so the tap underneath does not also fire. */
  const dragged = useRef(false)

  const handlers = {
    onPointerDown: (event: React.PointerEvent) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      from.current = { x: event.clientX, y: event.clientY }
      dragged.current = false
      setLeaving(null)
      setDragging(true)
    },
    onPointerMove: (event: React.PointerEvent) => {
      if (from.current === null) return
      const deltaX = event.clientX - from.current.x
      const deltaY = event.clientY - from.current.y
      if (Math.abs(deltaX) > 6) dragged.current = true
      setDx(Math.max(-140, Math.min(140, deltaX)))
      setDy(deltaY)
    },
    onPointerUp: () => {
      if (from.current === null) return
      from.current = null
      setDragging(false)
      commit(dx)
    },
    /*
     * A drag the browser takes away from us, which happens when the finger is travelling
     * diagonally and the browser reads the vertical part as a scroll. On a phone that is most
     * swipes: the gesture looks like nothing happened, twice, and the app looks broken. So a
     * cancel commits the swipe if the drag was mostly sideways — which is what the person was
     * doing, and the browser guessing otherwise should not overrule that.
     */
    onPointerCancel: () => {
      const mostlySideways = Math.abs(dx) > Math.abs(dy) * 1.5
      from.current = null
      setDragging(false)
      if (!mostlySideways) {
        setDx(0)
        return
      }
      commit(dx)
    },
  }

  /** Swallowed when the gesture was a drag: a swipe is not also a tap. */
  const wasDragged = () => dragged.current

  /** Finish a gesture: past the threshold it goes, otherwise it springs back. */
  function commit(delta: number) {
    if (Math.abs(delta) < SWIPE_AT) {
      setDx(0)
      setDy(0)
      return
    }
    const direction: SwipeDirection = delta > 0 ? 'right' : 'left'
    setLeaving(direction)
    setDx(direction === 'right' ? SWIPE_TRAVEL : -SWIPE_TRAVEL)
    window.setTimeout(() => {
      onSwipe(direction)
      setLeaving(null)
      setDx(0)
      setDy(0)
    }, 190)
  }

  const progress = Math.min(1, Math.abs(dx) / SWIPE_AT)
  return {
    handlers,
    wasDragged,
    progress,
    direction: dx === 0 ? null : dx > 0 ? ('right' as const) : ('left' as const),
    armed: progress >= 1,
    style: {
      transform: `translateX(${dx}px)`,
      transition: dragging ? 'none' : 'transform 190ms ease, opacity 190ms ease',
      opacity: leaving ? Math.max(0, 1 - progress) : 1,
      touchAction: 'pan-y' as const,
    },
  }
}

/**
 * Asking a friend for a move.
 *
 * A component of its own so it can be rendered wherever it was opened from: inside the move
 * card when there is a suggestion to react to, and below the card when there is not. It used
 * to render in one fixed place near the bottom of the screen, so pressing the button inside
 * the card opened the panel somewhere else entirely — which reads as the button having
 * opened the wrong thing.
 *
 * It holds its own state, so the pick and the note being typed survive the card re-rendering
 * underneath it.
 */
function AskPanel({
  blip,
  social,
  onClose,
  onAsked,
  onShare,
}: {
  blip: Blip
  social: SocialState
  onClose: () => void
  /** It went. Different from closing: the app's own suggestion is no longer the answer. */
  onAsked?: () => void
  onShare: () => void
}) {
  /** Everybody being asked. More than one is the ordinary case: you are stuck, and you know
   *  two people who might have an idea. */
  const [to, setTo] = useState<string[]>([])
  const [note, setNote] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const accepted = social.friends.filter((friend) => friend.status === 'accepted')
  /** There is somebody to ask, and something that may be shown to them. */
  const canAsk = blip.visibility === 'friends' && accepted.length > 0
  const chosen = accepted.filter((friend) => to.includes(friend.userId))

  function toggle(userId: string) {
    setTo((list) =>
      list.includes(userId) ? list.filter((id) => id !== userId) : [...list, userId],
    )
  }

  async function send() {
    if (chosen.length === 0 || sending) return
    setSending(true)
    try {
      // One message each, because an ask is one person's to answer: a single message with two
      // recipients would let the first answer look like it answered for both of them.
      const context = askContextFor(blip)
      const problems: string[] = []
      for (const friend of chosen) {
        const problemText = await social.ask({
          to: friend,
          context,
          note: note.trim() || undefined,
        })
        if (problemText) problems.push(`${friend.username}: ${problemText}`)
      }
      if (problems.length > 0) {
        setProblem(problems.join(' · '))
        return
      }
      if (onAsked) onAsked()
      else onClose()
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex w-full flex-col gap-2 rounded-2xl border border-line bg-surface/60 p-3">
      <p className="text-xs tracking-wide text-ink-faint uppercase">ask a friend for a move</p>

      {blip.visibility !== 'friends' ? (
        <p className="text-xs text-ink-soft">
          This one is private, so nobody can be shown it. Make it{' '}
          <button type="button" onClick={onShare} className="underline">
            shared with friends
          </button>{' '}
          first — asking somebody is showing them.
        </p>
      ) : accepted.length === 0 ? (
        <p className="text-xs text-ink-soft">
          You have not added anyone yet. Friends are added by username, and they have to say yes.
        </p>
      ) : (
        <>
          <p className="text-xs text-ink-soft">
            {chosen.length === 0
              ? 'pick who to ask — as many as you like'
              : `asking ${chosen.map((friend) => friend.username).join(', ')}`}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {accepted.map((friend) => (
              <button
                key={friend.userId}
                type="button"
                aria-pressed={to.includes(friend.userId)}
                onClick={() => toggle(friend.userId)}
                className={`rounded-full px-3 py-1.5 text-xs ${
                  to.includes(friend.userId)
                    ? 'bg-accent text-surface'
                    : 'border border-line text-ink-soft'
                }`}
              >
                {to.includes(friend.userId) ? '✓ ' : ''}
                {friend.username}
              </button>
            ))}
          </div>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void send()
            }}
            placeholder="anything you want to say about it (optional)"
            className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs outline-none focus:border-accent"
          />
          {problem ? <p className="text-xs text-warn">{problem}</p> : null}
        </>
      )}

      {/* Always, including when there is nothing to ask with: a panel you cannot close is
          a panel you are stuck in, and the two states above both have a way in and no way
          out — which is how it was until this line. */}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onClose} className="quiet text-xs underline">
          cancel
        </button>
        {canAsk ? (
          <button
            type="button"
            disabled={chosen.length === 0 || sending}
            onClick={() => void send()}
            className="ml-auto rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-40"
          >
            <ButtonLabel busy={sending}>
              {sending
                ? 'Asking…'
                : chosen.length === 0
                  ? 'Ask'
                  : chosen.length === 1
                    ? `Ask ${chosen[0]?.username ?? 'them'}`
                    : `Ask ${chosen.length} friends`}
            </ButtonLabel>
          </button>
        ) : null}
      </div>
    </div>
  )
}

/**
 * Whatever the move turned up to read.
 *
 * The extract is behind a tap. It is four or five lines of somebody else's prose — the most
 * text on the card by a distance, on a screen whose whole job is to get you to a two-minute
 * action — and the title and the description are enough to decide whether to read it.
 */
function Material({
  loading,
  material,
  className = 'mt-3',
}: {
  loading: boolean
  material: LookupResult | null
  className?: string
}) {
  const [open, setOpen] = useState(false)

  if (loading) {
    return (
      <div className={`${className} rounded-xl border border-line bg-surface/60 p-3`}>
        <span className="flex items-center gap-2 text-xs text-ink-faint">
          <Spinner className="h-3 w-3" />
          finding something to read…
        </span>
      </div>
    )
  }
  if (!material) return null

  return (
    <div className={`${className} rounded-xl border border-line bg-surface/60 p-3`}>
      <a
        href={material.url}
        target="_blank"
        rel="noreferrer"
        className="text-xs font-medium text-accent underline"
      >
        {material.title}
      </a>
      {material.description ? (
        <span className="text-xs text-ink-faint"> — {material.description}</span>
      ) : null}
      <button
        type="button"
        onClick={() => setOpen((shown) => !shown)}
        className="quiet ml-2 text-xs underline"
      >
        {open ? 'hide' : 'read it'}
      </button>
      {open ? (
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">{material.extract}</p>
      ) : null}
    </div>
  )
}

/**
 * What to look for. Rendered wherever the move is — including inside the composer,
 * so advice you asked for is still there when you sit down to use it.
 */
function Guidance({ items, className = 'mt-3' }: { items: string[] | null; className?: string }) {
  if (!items) return null
  return (
    <div className={`${className} rounded-xl border border-line bg-surface/60 p-3`}>
      {items.length === 0 ? (
        <p className="text-xs text-ink-faint">
          nothing came back — ask again, or just start and see
        </p>
      ) : (
        <>
          <p className="text-xs tracking-wide text-ink-faint uppercase">what to look for</p>
          <ul className="mt-1 flex flex-col gap-1.5">
            {items.map((item) => (
              <li key={item} className="text-xs leading-relaxed text-ink-soft">
                · {item}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/** The moves already put in front of you, quietly, behind a tap. */
function MoveLog({
  moves,
  onForget,
}: {
  moves: Blip['moves']
  /** Present when there is something worth forgetting. */
  onForget?: () => void
}) {
  if (moves.length === 0) return null
  const offered = moves.filter((entry) => entry.outcome === 'shown').length
  return (
    <details className="mt-5 border-t border-line pt-3">
      <summary className="cursor-pointer text-xs tracking-wide text-ink-faint uppercase">
        moves so far · {moves.length}
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
        {[...moves].reverse().map((entry) => (
          <li key={`${entry.moveId}-${entry.shownAt}`} className="text-xs text-ink-soft">
            <span
              className={
                entry.outcome === 'done'
                  ? 'text-good'
                  : entry.outcome === 'rejected'
                    ? 'text-warn'
                    : 'text-ink-faint'
              }
            >
              {entry.outcome === 'done' ? '✓' : entry.outcome === 'rejected' ? '✗' : '·'}
            </span>{' '}
            {entry.spec.title}
            <span className="text-ink-faint">
              {' — '}
              {entry.outcome === 'done' && entry.doneAt
                ? `done ${formatWhen(entry.doneAt)}`
                : entry.outcome === 'skipped'
                  ? `put down ${formatWhen(entry.shownAt)}`
                  : entry.outcome === 'rejected'
                    ? `marked bad ${formatWhen(entry.shownAt)}`
                    : `offered ${formatWhen(entry.shownAt)}`}
            </span>
          </li>
        ))}
      </ul>
      {onForget && offered > 0 ? (
        <div className="mt-3">
          <button type="button" onClick={onForget} className="quiet text-xs underline">
            forget the {offered} we only offered
          </button>
          <p className="mt-1 text-xs text-ink-faint">
            This list is what stops the same prompt coming back. If it is wrong — moves here you
            never saw — the app thinks you have tried everything and starts reaching for stranger
            angles. Forgetting the offers lets it suggest the obvious ones again. What you actually
            did is kept.
          </p>
        </div>
      ) : null}
    </details>
  )
}

export function Review({
  blips,
  actions,
  provider,
  related,
  onPromote,
  promoteResults,
  onExit,
  onBrowse,
  onOpenBlip,
  focusId,
  serverUrl,
  feedbackEnv,
  onFeedback,
  social,
  socialOn,
}: {
  blips: Blip[]
  actions: InklingActions
  provider: LLMProvider
  related: Map<string, RelatedBlip[]>
  onPromote: (blip: Blip, relatedBlips: Blip[]) => Promise<PromoteResult>
  promoteResults: Record<string, PromoteResult>
  onExit: () => void
  onBrowse: () => void
  onOpenBlip: (id: string) => void
  /** An Inkling picked from the list, or from the related list, to open first. */
  focusId?: string | null
  serverUrl: string
  feedbackEnv: FeedbackEnv
  onFeedback: (text: string, context: FeedbackContext) => Promise<unknown>
  social: SocialState
  socialOn: boolean
}) {
  const [session, setSession] = useState<string[] | null>(null)
  const [decisions, setDecisions] = useState<Record<string, Decision>>({})
  const [busy, setBusy] = useState(false)
  const [lastNote, setLastNote] = useState<{ title: string; path: string } | null>(null)
  const [material, setMaterial] = useState<LookupResult | null>(null)
  const [links, setLinks] = useState<MoveLink[]>([])
  const [noting, setNoting] = useState<'kudos' | 'thanks' | null>(null)
  /**
   * Which of the moves from friends is on the card.
   *
   * A ring, not a queue: swiping past one — and "do this later" — means "not now", not "never".
   * Who suggested something is the most interesting thing on the card, and the two things that
   * are actually final are doing it and "not this move", both of which are written down and
   * both of which take a move out of the ring for good.
   */
  const [ringIndex, setRingIndex] = useState(0)
  const [noteProblem, setNoteProblem] = useState<string | null>(null)
  /** Open while the note is being rendered and handed over. */
  const [exporting, setExporting] = useState(false)
  /** Whether the ask composer is open, wherever it was opened from. */
  const [askOpen, setAskOpen] = useState(false)
  const [materialLoading, setMaterialLoading] = useState(false)
  /** Open when non-null. A move means "doing that move"; null means a free note. */
  const [composer, setComposer] = useState<{
    move: MoveSpec | null
    /** Set when the move came from a friend, so the entry can name which one it answers. */
    fromMessageId?: string
  } | null>(null)
  const [entry, setEntry] = useState('')
  /** Whatever came with what is being written: a picture, pasted, dropped or picked. */
  const [entryFile, setEntryFile] = useState<File | undefined>()
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [draftBody, setDraftBody] = useState('')
  const [draftType, setDraftType] = useState<BlipType>('idea')
  /** Which question is in the middle of the screen, if any. */
  const [confirming, setConfirming] = useState<'retire' | 'delete' | null>(null)
  const [confirmingBusy, setConfirmingBusy] = useState(false)
  /** Open when the person is saying a suggestion was bad, rather than just unwanted. */
  const [rejecting, setRejecting] = useState(false)
  const [rejectionReason, setRejectionReason] = useState<string | null>(null)
  const [rejectionNote, setRejectionNote] = useState('')
  /**
   * Bumped when the move history changes underneath the suggestion — forgetting the
   * offers, say — so the card is reconsidered rather than left holding the suggestion
   * that was chosen when everything looked used up.
   */
  const [moveRevision, setMoveRevision] = useState(0)
  /** null means "not asked yet"; an empty list means "nothing came back". */
  const [guidance, setGuidance] = useState<string[] | null>(null)
  const [guidanceLoading, setGuidanceLoading] = useState(false)
  // A picked Inkling may not be due today, so focus starts in "all".
  const [scope, setScope] = useState<Scope>(focusId ? 'all' : 'today')

  const now = useMemo(() => new Date(), [blips])
  const today = useMemo(() => buildDailyFeed(blips, { now }), [blips, now])
  const near = useMemo(() => buildNearFeed(blips, { now }), [blips, now])
  const everything = useMemo(() => rankBlips(blips, { now }), [blips, now])
  const candidates = scope === 'today' ? today : scope === 'near' ? near : everything
  const byId = useMemo(() => new Map(blips.map((blip) => [blip.id, blip])), [blips])

  const focus = focusId ? blips.find((blip) => blip.id === focusId) : undefined
  const focusKey = focus?.id ?? ''

  // Changing scope, or opening a different Inkling, starts a new round.
  const lastScope = useRef(scope)
  useEffect(() => {
    if (lastScope.current === scope) return
    lastScope.current = scope
    setSession(null)
    setDecisions({})
    setComposer(null)
    setLastNote(null)
  }, [scope])

  const SCOPES: Array<{ id: Scope; label: string; count: number }> = [
    { id: 'today', label: 'Today', count: today.length },
    { id: 'near', label: 'Near Future', count: near.length },
    { id: 'all', label: 'All', count: everything.length },
  ]

  const lastFocus = useRef(focusKey)
  useEffect(() => {
    if (lastFocus.current === focusKey) return
    lastFocus.current = focusKey
    setSession(null)
    setDecisions({})
    setComposer(null)
  }, [focusKey])

  // Freeze the round when it starts, so acting on an Inkling cannot reshuffle it.
  /**
   * What the round pages through: what is due, and then everything else in play.
   *
   * The due ones come first and are what the round *is* — "1 of 4" counts those, and the round
   * ends when they have all been dealt with. The rest are there so that paging up and down has
   * somewhere to go: an Inkling you are not due to see is still one you might want to look at,
   * and a card you can only scroll inside of is a card you cannot leave.
   */
  const pagingPool = useMemo(() => {
    const extra = everything.filter((blip) => !candidates.some((entry) => entry.id === blip.id))
    return [...candidates, ...extra]
  }, [candidates, everything])

  useEffect(() => {
    if (session !== null) return
    const ordered = buildRound(pagingPool, byId, focusKey)
    if (ordered.length > 0) setSession(ordered)
  }, [pagingPool, session, focusKey, byId])

  /**
   * Inklings waved past this round by swiping up.
   *
   * Not a decision: nothing is written down, and the round simply moves on to the next one.
   * Swiping down takes the last one back, which is what makes it a scroll through the round
   * rather than a sequence of decisions.
   */
  const [skipped, setSkipped] = useState<string[]>([])
  const queue = useMemo(
    () => roundQueue(session, candidates, byId, new Set([...Object.keys(decisions), ...skipped])),
    [session, candidates, byId, decisions, skipped],
  )
  // The round's size is frozen when it starts, not recomputed after a deletion — else
  // deleting the last Inkling in a round would read as "nothing was waiting". It counts
  // everything the round will page through, which is what "2 of 4" has to mean when swiping up
  // and down moves through four cards.
  const total = session?.length ?? pagingPool.length
  const done = total - queue.length
  const current = queue[0]
  const currentRelated = current ? (related.get(current.id) ?? []) : []
  const {
    move,
    loading: moveLoading,
    reroll,
    generate: generateMove,
    discard: discardMove,
    nextAiMove,
  } = useSuggestedMove(
    current,
    currentRelated.map((entry_) => entry_.blip),
    provider,
    moveRevision,
  )

  const deferLabel = formatDeferral(deferUntil(DEFAULT_DEFERRAL, new Date()))
  /** Just the day, for the label under a round button: "till Monday", not "until Monday". */
  const deferDay = deferLabel.replace(/^(until|in)\s+/, '')
  /** "till Tue" — the same day, in the width the row has for it. The full name is the title. */
  const deferShort = `till ${formatShortWeekday(deferUntil(DEFAULT_DEFERRAL, new Date()))}`

  // Advice belongs to the move it was asked about. A different move means different
  // advice, so clear it rather than show something that no longer applies.
  const moveId = move?.id ?? ''
  useEffect(() => {
    setGuidance(null)
  }, [moveId])

  // Record what was put in front of you, so it is not offered again. Once per move
  // per Inkling — and once per *wording*, because a re-adapted move is a different
  // thing shown, and leaving it unrecorded is how the same move came back over and
  // over with a new title each time.
  const recorded = useRef(new Set<string>())
  useEffect(() => {
    if (!current || !move || moveLoading) return
    const key = `${current.id}:${move.id}:${move.title}`
    if (recorded.current.has(key)) return
    recorded.current.add(key)
    const alreadyRecorded = current.moves.some(
      (entry_) => entry_.moveId === move.id && entry_.spec.title === move.title,
    )
    if (!alreadyRecorded) {
      void actions.recordMoveShown(current.id, move)
    }
  }, [current, move, moveLoading, actions])

  /**
   * The move to put in front of them.
   *
   * A friend's move comes first while it is unanswered: somebody spent a moment on this on
   * their behalf, and burying it under the app's own suggestion would be answering the
   * wrong question. Once something is written against it, the suggestion returns.
   */
  /**
   * Whose move is on the card.
   *
   * Sequential: whoever has been waiting longest goes first, and answering it — or waving it
   * away — brings the next one. "Later" is this round only, kept here rather than in the log
   * because it is about when, not about what happened: it comes back next time.
   */
  const pendingMoves = current ? pendingFriendMoves(current) : []
  /**
   * Where the swipe has got to.
   *
   * The moves first, then the form for asking somebody yourself — because "nobody has suggested
   * anything" and "I have seen what they suggested and none of it is it" are the same situation
   * from here, and both want the same answer. It is the last slot in the ring rather than
   * something that happens when the ring runs out, so swiping always does something visible.
   */
  const friendMove = pendingMoves[ringIndex]
  /** Whether a swipe has moved the ring on this card: the ask slot is not where a card opens. */
  const [ringTouched, setRingTouched] = useState(false)
  /** Their colour, from their own settings. Undefined when they have not chosen one. */
  const friendColour = social.friends.find((entry) => entry.userId === friendMove?.from)?.color
  const atAskSlot =
    ringTouched && (pendingMoves.length > 0 ? ringIndex >= pendingMoves.length : true)
  const nextFriendMove = () => {
    setRingTouched(true)
    setRingIndex((index) => (index + 1) % (pendingMoves.length + 1))
  }

  /**
   * Which of the two the card is showing.
   *
   * One move at a time, because two on a card is a card you read rather than act on. A friend
   * who has suggested something is the more interesting of the two, so that is what a card
   * opens on; swiping left moves to the app's own, and swiping right moves back.
   */
  const [slot, setSlot] = useState<'friend' | 'ai'>('friend')
  const slotNow: 'friend' | 'ask' | 'ai' = slot === 'ai' ? 'ai' : atAskSlot ? 'ask' : 'friend'

  const swipe = (direction: SwipeDirection) => {
    if (direction === 'right') {
      // Back to what people suggested, and on round the ring: the next move, or the form for
      // asking somebody. Never a dead end.
      setSlot('friend')
      nextFriendMove()
      return
    }
    setSlot('ai')
    nextAiMove()
  }

  const swipeState = useMoveSwipe(swipe)
  /** A phone has the swipes; a mouse does not, so the buttons stay there. */
  const isTouch = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(hover: none)').matches,
    [],
  )
  const round = useRoundSwipe({
    hasNext: queue.length > 1,
    hasPrevious: skipped.length > 0,
    next: () => current && setSkipped((list) => [...list, current.id]),
    previous: () => setSkipped((list) => list.slice(0, -1)),
  })
  const shownMove = composer?.move ?? friendMove?.spec ?? move

  // Where this move sends you. Resolved together, because they are independent and a
  // move that sends you three places should not appear one link at a time.
  const lookUp = shownMove?.lookUp ?? []
  const lookUpKey = lookUp.join('\u0000')
  useEffect(() => {
    if (lookUp.length === 0) {
      setLinks([])
      setMaterial(null)
      setMaterialLoading(false)
      return
    }
    let cancelled = false
    setLinks([])
    setMaterial(null)
    setMaterialLoading(true)
    void lookupVia(serverUrl, lookUp).then((found) => {
      if (cancelled) return
      setLinks(found.links)
      setMaterial(found.material)
      setMaterialLoading(false)
    })
    return () => {
      cancelled = true
    }
    // Keyed on the phrases themselves: `lookUp` is a fresh array every render.
  }, [lookUpKey, serverUrl])

  function settle(decision: Decision) {
    if (!current) return
    setDecisions((previous) => ({ ...previous, [current.id]: decision }))
    setComposer(null)
    setEntry('')
    setGuidance(null)
    setEditing(false)
    setRejecting(false)
    setRejectionReason(null)
    setRejectionNote('')
    setNoting(null)
    setNoteProblem(null)
    setAskOpen(false)
    setExporting(false)
    setEntryFile(undefined)
  }

  /**
   * Everything the model was working from.
   *
   * The point of the whole feature: a rejection without this says "wrong" and nothing
   * else, and by the time anyone looks at it the move history holds only what was
   * offered, not what it was offered for.
   */
  function rejectionContext(): RejectionContext | null {
    if (!current) return null
    return {
      blipType: current.type,
      blipTitle: current.title,
      topics: current.topics,
      entries: current.entries.length,
      alreadyOffered: current.moves.map((entry_) => entry_.moveId),
      related: currentRelated.map((entry_) => entry_.blip.title),
    }
  }

  /**
   * Say a suggestion was bad, and ask for a better one for the same Inkling.
   *
   * Deliberately not a decision about the Inkling: "this is bad" is a request for another
   * suggestion, not a reason to move on. The rejection goes into the prompt for the next
   * one, so it is a correction rather than a reroll — and the refetch is keyed on the
   * rejection count, so it cannot happen before the rejection is in the projection.
   */
  async function reject() {
    if (!current || !move) return
    const context = rejectionContext()
    if (!context) return
    setBusy(true)
    try {
      await actions.rejectMove(
        current.id,
        move,
        context,
        rejectionReason ?? undefined,
        rejectionNote.trim() || undefined,
      )
      setRejecting(false)
      setRejectionReason(null)
      setRejectionNote('')
    } finally {
      setBusy(false)
    }
  }

  async function saveForLater() {
    if (!current || !move) return
    // Keep the move, and put the Inkling down so it comes back with that move.
    await actions.saveMove(current.id, move)
    await actions.snooze(current.id, deferUntil(DEFAULT_DEFERRAL, new Date()))
    settle('deferred')
  }

  async function askForGuidance(again = false) {
    if (!current) return
    setGuidanceLoading(true)
    try {
      const result = await requestGuidance(
        {
          blip: current,
          move,
          material: material ? { title: material.title, extract: material.extract } : null,
          // Asking from inside the move: what they have started writing is context,
          // and what they already have is what not to say again.
          draft: composer?.move ? entry : undefined,
          previous: again ? (guidance ?? []) : [],
        },
        provider,
      )
      setGuidance(result?.items ?? [])
    } finally {
      setGuidanceLoading(false)
    }
  }

  async function saveEdit() {
    if (!current) return
    await actions.editBlip(current.id, {
      title: draftTitle.trim(),
      body: draftBody,
      type: draftType,
    })
    setEditing(false)
  }

  async function saveEntry() {
    if (!current || !composer || busy) return
    setBusy(true)
    try {
      const url = findUrl(entry)
      const draft: EntryDraft = {
        // A link in what was written is the link as well as the words, so an entry can be
        // a page somebody found and not only the sentence about it.
        text: url && isOnlyALink(entry) ? undefined : entry,
        url: url ?? undefined,
        file: entryFile,
        // Which friend's move this answers. Without it the move stays on the card and the
        // next one never arrives.
        fromMessageId: composer.fromMessageId,
      }
      if (composer.move) {
        // Keep what surrounded the answer with the answer: the move, the material it
        // turned up, and whatever "help me with the next step" suggested. None of it
        // exists anywhere else once this screen moves on.
        await actions.completeMove(
          current.id,
          composer.move,
          draft,
          entryContext({ material, guidance }),
        )
      } else {
        if (draft.text || draft.url || draft.file) await actions.addEntry(current.id, draft)
        await actions.snoozeAfter(current.id, 'engaged', current.schedule.timesEngaged)
      }
      settle('advanced')
    } finally {
      setBusy(false)
    }
  }

  async function defer(choice: DeferralChoice) {
    if (!current) return
    await actions.snooze(current.id, deferUntil(choice, new Date()))
    settle('deferred')
  }

  async function retire() {
    if (!current) return
    await actions.retire(current.id)
    settle('retired')
  }

  /** Deliberately not the same word as retire. This one leaves the app. */
  async function remove() {
    if (!current) return
    await actions.deleteBlip(current.id)
    settle('deleted')
  }

  async function revive() {
    if (!current) return
    await actions.revive(current.id)
    settle('revived')
  }

  async function promote() {
    if (!current) return
    const result = await onPromote(
      current,
      currentRelated.map((entry_) => entry_.blip),
    )
    if (result.ok && result.path) {
      // The Inkling leaves the queue on success, so remember where it went.
      setLastNote({ title: current.title, path: result.path })
      settle('promoted')
    }
  }

  if (!current) {
    const counts = Object.values(decisions)
    const advanced = counts.filter((value) => value === 'advanced').length
    /**
     * Everything still in play, including what this round deferred.
     *
     * The first version counted only what rankBlips returns, which is the Inklings that are
     * due now — so a round spent putting all four down, deliberately leaving them for the
     * future, cheerfully reported "0 left for the future". A deferral is the one case where
     * this number has to include what you just did, because leaving it for later is exactly
     * what you did.
     */
    const stillToCome = blips.filter(
      (blip) => !blip.deleted && (blip.status === 'active' || blip.status === 'snoozed'),
    ).length

    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
        <p className="text-2xl font-semibold">{done === 0 ? 'Nothing waiting' : 'Done for now'}</p>
        {done > 0 ? (
          /* Two numbers and no accounting. A row of six counters, most of them nought, reads
             as a receipt for a transaction you did not know you were making — and "nothing
             lost" is reassurance for a worry nobody had. What matters is what you did and how
             much is still waiting. */
          <p className="text-lg font-medium text-ink">
            {advanced} move{advanced === 1 ? '' : 's'} made · {stillToCome} left for the future
          </p>
        ) : (
          <p className="text-sm text-ink-soft">Capture something, or look in the attic.</p>
        )}
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setDecisions({})
              setSession(null)
              // A new round starts at the first move again.
              setRingIndex(0)
            }}
            className="rounded-full border border-line bg-surface px-5 py-3 text-sm font-medium"
          >
            Another round
          </button>
          <button
            type="button"
            onClick={onExit}
            className="rounded-full bg-ink px-5 py-3 text-sm font-semibold text-surface"
          >
            Home
          </button>
        </div>
        {scope === 'today' && everything.length > today.length ? (
          <button
            type="button"
            onClick={() => setScope('all')}
            className="quiet mt-1 text-xs underline"
          >
            or review all {everything.length}
          </button>
        ) : null}
      </div>
    )
  }

  /** Entries that have something to show: words, a link, a picture, or a few of those. */
  const written = current.entries.filter((entry_) => entry_.text || entry_.url || entry_.mediaId)
  /** The move that prompted an entry, from the one place a move spec lives. */
  const moveForEntry = (moveId?: string): MoveSpec | undefined =>
    moveId ? current.moves.find((entry_) => entry_.moveId === moveId)?.spec : undefined

  return (
    <div className="flex flex-1 flex-col">
      <div className="mb-3 flex items-center gap-2">
        {/* Three windows on the same list: what is due now, what is coming back inside the
            week, and everything. "All" used to mean "everything active", which is not a
            thing anybody is looking for at a glance — the useful middle is what is near. */}
        {SCOPES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setScope(option.id)}
            /* `whitespace-nowrap`, because "Today · 1" is now wider than the chip and wraps
               into "Today ·" over "1", which reads as a broken chip rather than a tight one. */
            className={`rounded-full px-3 py-1 text-xs whitespace-nowrap transition ${
              scope === option.id
                ? 'bg-ink font-medium text-surface'
                : 'border border-line text-ink-soft'
            }`}
          >
            {option.label}
            {option.count > 0 ? ` · ${option.count}` : ''}
          </button>
        ))}
        <button type="button" onClick={onBrowse} className="quiet text-xs underline">
          browse
        </button>
        <span className="ml-auto text-xs whitespace-nowrap text-ink-faint">
          {done + 1} of {total}
        </span>
      </div>

      <div className="relative flex flex-1 flex-col">
        <div ref={round.cardRef} className="card flex flex-1 flex-col overflow-y-auto p-6">
          {/* The way to the other Inklings in this round, stuck to the top and the bottom of the
              card so it is always there — and `touch-action: none`, so a swipe on it is a swipe
              and never a scroll. Taking over the whole card's vertical drags instead was the
              first two attempts, and both failed for the same reason: the card scrolls, so the
              browser takes the gesture and cancels the pointer before it can mean anything.
              Tapping works too, which is what a hint strip should have been all along. */}
          {round.showPrevious ? (
            <button
              type="button"
              {...round.handlers}
              onClick={() => round.previous()}
              className={`sticky top-0 z-10 -mt-2 mb-2 w-full touch-none py-1 text-center text-[11px] ${
                round.pull === 'down' && round.armed
                  ? 'font-semibold text-accent'
                  : 'text-ink-faint'
              }`}
            >
              ▲ the previous Inkling
            </button>
          ) : null}
          {/* What a drag in each direction would do, shown while you are pulling and highlighted
            once it would happen. On the card rather than on the move, so it stays put while
            the move slides away underneath it. */}
          {swipeState.direction ? (
            <span
              className={`pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-accent px-3 py-2 text-xs font-semibold text-surface transition-transform ${
                swipeState.direction === 'right' ? 'left-3' : 'right-3'
              } ${swipeState.armed ? 'scale-110' : 'opacity-70'}`}
            >
              {swipeState.direction === 'right'
                ? `☺ ${friendMove ? friendMove.fromUsername : 'ask a friend'}`
                : '✦ the app'}
            </span>
          ) : null}
          <div className="flex items-center gap-2 text-xs tracking-wide uppercase">
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent">
              {current.type}
            </span>
            {current.demo ? (
              <span className="rounded-full border border-line px-2 py-0.5 text-ink-faint">
                example
              </span>
            ) : null}
            {/* Per Inkling, and always changeable. What you noticed on Tuesday is not the
              same as what you noticed on Friday, and one setting for both is a setting
              nobody can answer honestly. */}
            {/* Who can see it, as faces rather than as a word. The word had to be decoded;
              a row of faces is read. Nothing at all when it is private — the absence is the
              message, and greyed-out faces would say something louder than the thing itself. */}
            {socialOn ? (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void actions.share(
                      current.id,
                      current.visibility === 'friends' ? 'private' : 'friends',
                    )
                  }
                  title={
                    current.visibility === 'friends'
                      ? 'Your friends can see this. Tap to keep it private.'
                      : 'Nobody can be shown this. Tap to share it with friends.'
                  }
                  className={`rounded-full border px-2 py-0.5 disabled:opacity-50 ${
                    current.visibility === 'friends'
                      ? 'border-accent/50 font-medium text-accent'
                      : 'border-line text-ink-faint'
                  }`}
                >
                  {current.visibility === 'friends' ? 'Friends' : 'Private'}
                </button>
                {current.visibility === 'friends' ? (
                  <FriendFaces friends={social.friends.filter((f) => f.status === 'accepted')} />
                ) : null}
              </>
            ) : null}
            {current.schedule.timesSkipped > 0 ? (
              <span className="text-ink-faint">put down {current.schedule.timesSkipped}×</span>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setDraftTitle(current.title)
                setDraftBody(current.body)
                setDraftType(current.type)
                setEditing(true)
              }}
              className="quiet ml-auto text-xs underline"
            >
              edit
            </button>
          </div>

          {editing ? (
            <div className="mt-3 flex flex-col gap-2">
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                className="w-full rounded-xl border border-line bg-surface p-3 text-base font-semibold outline-none focus:border-accent"
              />
              <textarea
                value={draftBody}
                onChange={(event) => setDraftBody(event.target.value)}
                rows={5}
                className="w-full resize-none rounded-xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent"
              />
              {/* A blip that started as a question often turns out to be something else. */}
              <div className="flex flex-wrap gap-1.5">
                {BLIP_TYPES.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setDraftType(option)}
                    className={`rounded-full px-2.5 py-1 text-xs capitalize ${
                      draftType === option
                        ? 'bg-accent text-surface'
                        : 'border border-line text-ink-faint'
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setEditing(false)} className="quiet text-xs">
                  cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  className="ml-auto rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <>
              <Markdown text={current.title} className="mt-3 text-xl leading-snug font-semibold" />
              {current.body && current.body !== current.title ? (
                <Markdown text={current.body} className="mt-2 text-sm text-ink-soft" />
              ) : null}
            </>
          )}

          {current.input?.url ? (
            <a
              href={current.input.url}
              target="_blank"
              rel="noreferrer"
              className="mt-2 block truncate text-xs text-accent underline"
            >
              {current.input.url}
            </a>
          ) : null}

          {/* Everything written down, in the order it was written, each showing whatever came
            with it. This used to be two lists — pictures here, words there — which meant a
            photograph and the sentence about it could end up in different places on the
            card. */}
          {written.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-3">
              {written.map((entry_) => (
                <li key={entry_.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    {entry_.mediaId ? (
                      <StoredImage
                        hash={entry_.mediaId}
                        className="mb-2 max-h-64 rounded-xl border border-line object-cover"
                      />
                    ) : null}
                    {entry_.text ? (
                      <Markdown text={entry_.text} className="text-sm text-ink-soft" />
                    ) : null}
                    {entry_.url ? (
                      <a
                        href={entry_.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block truncate text-xs text-accent underline"
                      >
                        {entry_.url}
                      </a>
                    ) : null}
                    <EntryContextPanel entry={entry_} move={moveForEntry(entry_.moveId)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => void actions.removeEntry(current.id, entry_.id)}
                    aria-label="Remove this entry"
                    className="quiet px-1 text-xs leading-none"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <Blocks blip={current} actions={actions} />

          {slotNow === 'friend' && friendMove && !askOpen ? (
            <div
              key={friendMove.messageId}
              {...swipeState.handlers}
              style={{
                ...swipeState.style,
                // Their colour, from their settings: the quickest cue that this came from a
                // person rather than from the app, and the same cue wherever they appear.
                borderColor: friendColour ?? undefined,
                background: friendColour ? `${friendColour}14` : undefined,
              }}
              className="move-in relative mt-5 rounded-2xl border border-line bg-surface/60 p-4"
            >
              {/* Left and right of the move, because that is what the swipe moves between: this
                  suggestion and the other source — not between whole Inklings. */}
              <span className="pointer-events-none absolute top-1/2 -left-2 flex -translate-y-1/2 items-center rounded-full bg-surface p-0.5 shadow-circle">
                <Avatar
                  username={friendMove.fromUsername}
                  userId={friendMove.from}
                  color={friendColour}
                  hash={social.friends.find((f) => f.userId === friendMove.from)?.avatar}
                  size={20}
                />
              </span>
              <span className="pointer-events-none absolute top-1/2 -right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-sm text-accent shadow-circle">
                ✦
              </span>
              <div className="flex items-center gap-2.5">
                <Avatar
                  username={friendMove.fromUsername}
                  userId={friendMove.from}
                  color={social.friends.find((f) => f.userId === friendMove.from)?.color}
                  hash={social.friends.find((f) => f.userId === friendMove.from)?.avatar}
                  size={28}
                />
                <p className="text-xs tracking-wide text-ink-faint uppercase">
                  a move from {friendMove.fromUsername}
                </p>
              </div>
              {/* The whole title is the button: on a phone, tapping the move is how you do it. */}
              <button
                type="button"
                onClick={() => {
                  if (swipeState.wasDragged()) return
                  setComposer({ move: friendMove.spec, fromMessageId: friendMove.messageId })
                }}
                className="mt-1 block text-left"
              >
                <span className="block text-sm font-medium">{friendMove.spec.title}</span>
                <span className="mt-1 block text-xs text-ink-soft">
                  goal: {friendMove.spec.goal}
                </span>
              </button>
              {friendMove.note ? (
                <p className="mt-2 text-xs text-accent italic">“{friendMove.note}”</p>
              ) : null}

              {!composer ? <LookUps links={links} loading={materialLoading} /> : null}
              {!composer && material ? (
                <Material loading={materialLoading} material={material} />
              ) : null}

              {!composer ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setComposer({ move: friendMove.spec, fromMessageId: friendMove.messageId })
                    }
                    className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface"
                  >
                    Do this
                  </button>
                  <span className="text-xs text-ink-faint">
                    {Math.max(1, Math.round(friendMove.spec.timeLimitSec / 60))} min
                  </span>
                  <button
                    type="button"
                    onClick={() => setNoting('thanks')}
                    className="quiet text-xs underline"
                  >
                    say thank you
                  </button>
                </div>
              ) : null}

              {/* Two ways past a move from a friend, and they mean different things.
                "Later" puts it back in the pile: the card shows whoever is next, or the app's
                own suggestion if nobody else has sent one, and this comes round again in a
                later round. "Not this move" is about the suggestion itself — it leaves the
                card for good and stays in the log and in the history with them. */}
              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                {/* Reachable without the row: on a phone the row is gone while a move is on
                  screen, and "write my own" is a verb rather than a source to browse. */}
                <button
                  type="button"
                  onClick={() => setComposer({ move: null })}
                  className="quiet underline"
                >
                  write my own
                </button>
                <button type="button" onClick={nextFriendMove} className="quiet underline">
                  do this later
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void actions.dismissFriendMove(current.id, friendMove.messageId)}
                  className="quiet underline disabled:opacity-40"
                >
                  not this move
                </button>
              </div>

              {noting && !composer ? (
                <Note
                  kind={noting}
                  username={friendMove.fromUsername}
                  moveTitle={friendMove.spec.title}
                  busy={busy}
                  onCancel={() => setNoting(null)}
                  onSend={async (text) => {
                    const friend = social.friends.find(
                      (candidate) => candidate.userId === friendMove.from,
                    )
                    if (!friend) {
                      setNoteProblem('they are no longer a friend')
                      return
                    }
                    const problemText = await social.note({
                      to: friend,
                      blipId: current.id,
                      kind: noting,
                      moveTitle: noting === 'kudos' ? friendMove.spec.title : undefined,
                      text,
                    })
                    setNoteProblem(problemText)
                    if (!problemText) setNoting(null)
                  }}
                  problem={noteProblem}
                />
              ) : null}

              {current.friendNotes.length > 0 ? (
                <ul className="mt-3 flex flex-col gap-1">
                  {current.friendNotes.map((note) => (
                    <li key={note.id} className="text-xs text-ink-soft">
                      <span className="text-ink-faint">
                        {note.direction === 'in' ? note.username : `you → ${note.username}`}
                        {note.kind === 'kudos' ? ' · kudos' : ' · thanks'}:{' '}
                      </span>
                      {note.text}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* Asking a friend puts its next step where generating a move puts its result:
            inside the card, above the actions. It used to open under the two buttons at the
            bottom of the screen, so the thing you had just started was somewhere other than
            where the thing you might have started instead would have been. */}
          {!composer && askOpen ? (
            <div className="mt-5">
              <AskPanel
                blip={current}
                social={social}
                onClose={() => setAskOpen(false)}
                onShare={() => void actions.share(current.id, 'friends')}
                // Asking a person is the other way of getting a move, so the one the app made
                // is no longer the thing being answered: it goes, and the two buttons come
                // back for whenever the answer arrives.
                onAsked={() => {
                  setAskOpen(false)
                  discardMove()
                }}
              />
            </div>
          ) : null}

          {composer ? (
            <div className="mt-5 flex flex-col gap-3">
              {composer.move ? (
                <p className="text-xs tracking-wide text-accent uppercase">
                  doing: {composer.move.title}
                </p>
              ) : null}
              {/* What the move turned up, and anything the app suggested, stay here
                while you write — that is the whole point of having asked. */}
              {composer.move && links.length > 0 ? (
                <LookUps links={links} loading={materialLoading} />
              ) : null}
              {composer.move && material ? (
                <Material loading={materialLoading} material={material} className="" />
              ) : null}
              <div
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  const image = imageFrom(event.dataTransfer)
                  if (!image) return
                  event.preventDefault()
                  setEntryFile(image)
                }}
                className="flex flex-col gap-2"
              >
                <textarea
                  value={entry}
                  onChange={(event) => setEntry(event.target.value)}
                  onPaste={(event) => {
                    const image = imageFrom(event.clipboardData)
                    if (image) setEntryFile(image)
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                      event.preventDefault()
                      void saveEntry()
                    }
                  }}
                  rows={6}
                  placeholder={composer.move ? composer.move.goal : 'What did you get?'}
                  className="w-full resize-none rounded-2xl border border-line p-4 text-sm outline-none focus:border-accent"
                />
                {entryFile ? (
                  <span className="flex items-center gap-3 rounded-2xl border border-line bg-surface/60 p-2 pl-3 text-xs">
                    <span className="text-ink-soft">🖼</span>
                    <span className="min-w-0 flex-1 truncate">{entryFile.name}</span>
                    <button
                      type="button"
                      onClick={() => setEntryFile(undefined)}
                      className="quiet underline"
                      aria-label="Remove the image"
                    >
                      remove
                    </button>
                  </span>
                ) : null}
              </div>

              {/* Adding structure belongs where you are writing, not on the card you are
                reading — so the picker is here, and the blocks it makes show up on the
                card. */}
              <div className="flex flex-wrap items-center gap-2">
                <label
                  className="circle h-10 w-10 shrink-0 cursor-pointer text-base"
                  title="Add an image"
                >
                  📎
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => setEntryFile(event.target.files?.[0] ?? undefined)}
                  />
                </label>
                <BlockPicker
                  count={current.blocks.length}
                  onAdd={(kind) => actions.addBlock(current.id, newBlock(kind))}
                />
              </div>
              {composer.move ? (
                <div className="flex flex-wrap items-center gap-4 text-xs">
                  <button
                    type="button"
                    onClick={() => void askForGuidance(true)}
                    disabled={guidanceLoading}
                    className="quiet underline disabled:no-underline disabled:opacity-60"
                  >
                    <ButtonLabel busy={guidanceLoading}>
                      {guidanceLoading
                        ? 'thinking…'
                        : guidance
                          ? 'help me further'
                          : 'help me with this'}
                    </ButtonLabel>
                  </button>
                </div>
              ) : null}
              <Guidance items={guidance} className="" />
              <div className="flex items-center gap-3">
                <button type="button" onClick={() => setComposer(null)} className="quiet text-xs">
                  cancel
                </button>
                <button
                  type="button"
                  onClick={() => void saveEntry()}
                  disabled={busy}
                  className="ml-auto rounded-full bg-ink px-6 py-3 text-sm font-semibold text-surface disabled:opacity-40"
                >
                  <ButtonLabel busy={busy}>{busy ? 'Saving…' : 'Keep it'}</ButtonLabel>
                </button>
              </div>
            </div>
          ) : slotNow === 'ask' || askOpen ? (
            /* The end of the ring, and where a swipe with nothing left to show lands. Asking is
               what you do when nobody has suggested anything, or when what they suggested is not
               it — the same situation, so the same place. */
            <div className="mt-5">
              <AskPanel
                blip={current}
                social={social}
                onClose={() => {
                  setAskOpen(false)
                  setRingIndex(0)
                  setSlot('friend')
                }}
                onAsked={() => {
                  setAskOpen(false)
                  setRingIndex(0)
                  setRingTouched(false)
                  setSlot('friend')
                  discardMove()
                }}
                onShare={() => void actions.share(current.id, 'friends')}
              />
            </div>
          ) : slotNow === 'ai' && moveLoading && !askOpen ? (
            /* While a new one is being found, show that rather than the one you just swiped
             away: a suggestion sitting there unchanged is indistinguishable from a swipe that
             did not register, which is exactly how "not this one" used to look broken. */
            <div className="mt-5 flex items-center gap-3 rounded-2xl bg-accent-soft/70 p-4">
              <Spinner className="h-4 w-4 text-accent" />
              <span className="text-sm text-ink-soft">finding something else…</span>
            </div>
          ) : slotNow === 'ai' && move && !askOpen ? (
            <div
              key={move.id}
              {...swipeState.handlers}
              style={swipeState.style}
              className={`move-in relative mt-5 rounded-2xl bg-accent-soft/70 p-4 ${
                moveLoading ? 'opacity-60' : ''
              }`}
            >
              <span className="pointer-events-none absolute top-1/2 -left-2 flex -translate-y-1/2 items-center rounded-full bg-surface p-0.5 shadow-circle">
                <Avatar
                  username={pendingMoves[0]?.fromUsername ?? 'a friend'}
                  userId={pendingMoves[0]?.from ?? ''}
                  color={social.friends.find((f) => f.userId === pendingMoves[0]?.from)?.color}
                  hash={social.friends.find((f) => f.userId === pendingMoves[0]?.from)?.avatar}
                  size={20}
                />
              </span>
              <span className="pointer-events-none absolute top-1/2 -right-2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-sm text-accent shadow-circle">
                ✦
              </span>
              <p className="text-xs tracking-wide text-accent uppercase">a move, if you want one</p>
              <button
                type="button"
                onClick={() => {
                  if (swipeState.wasDragged()) return
                  setComposer({ move })
                }}
                className="mt-1 block text-left"
              >
                <span className="block text-sm font-medium">{move.title}</span>
                <span className="mt-1 block text-xs text-ink-soft">goal: {move.goal}</span>
              </button>
              {current.savedMove ? (
                <p className="mt-1 text-xs text-good">
                  {current.demo
                    ? 'the move that comes with the example'
                    : 'saved — this is the move you kept'}
                </p>
              ) : null}

              <LookUps links={links} loading={materialLoading} />
              {material ? <Material loading={materialLoading} material={material} /> : null}

              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => setComposer({ move })}
                  disabled={moveLoading}
                  className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-40"
                >
                  Do this
                </button>
                <span className="text-xs text-ink-faint">
                  {Math.max(1, Math.round(move.timeLimitSec / 60))} min ·{' '}
                  {move.generatedBy === 'llm'
                    ? 'adapted'
                    : current.demo
                      ? 'the example'
                      : 'from the playbook'}
                </span>
                <button
                  type="button"
                  onClick={reroll}
                  disabled={moveLoading}
                  className="quiet ml-auto underline disabled:no-underline disabled:opacity-60"
                >
                  <ButtonLabel busy={moveLoading}>
                    {moveLoading ? 'finding another…' : 'not this one'}
                  </ButtonLabel>
                </button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                <button
                  type="button"
                  onClick={() => void saveForLater()}
                  className="quiet underline"
                >
                  save for later
                </button>
                <button
                  type="button"
                  onClick={() => void askForGuidance()}
                  disabled={guidanceLoading}
                  className="quiet underline disabled:no-underline disabled:opacity-60"
                >
                  <ButtonLabel busy={guidanceLoading}>
                    {guidanceLoading ? 'thinking…' : 'help me with the next step'}
                  </ButtonLabel>
                </button>
                {/* A different signal from "not this one", which means "not at the moment".
                  This one says the suggestion itself was wrong, and it is kept. */}
                <button
                  type="button"
                  onClick={() => setRejecting(true)}
                  className="quiet underline"
                >
                  this is bad
                </button>
              </div>

              {/* Right next to the suggestion, and louder than the rest of this row, because
                this is the moment the question occurs to somebody: the move is not it, and
                there is a person who might know better. It used to be a quiet link under the
                card, which is where things go to be not found. */}
              {/* Only when the friend's move is not the one on screen: there is one ask per
                card, always in the place you were looking when you wanted it. */}
              {socialOn && !current.demo && !friendMove ? (
                <div className="mt-3 flex flex-col gap-2">
                  {askOpen ? (
                    <AskPanel
                      blip={current}
                      social={social}
                      onClose={() => setAskOpen(false)}
                      onShare={() => void actions.share(current.id, 'friends')}
                    />
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => setAskOpen(true)}
                        className="self-start rounded-full border border-accent/50 px-3.5 py-2 text-xs font-medium text-accent"
                      >
                        ask a friend for a move
                      </button>
                      {social.friends.some((friend) => friend.status === 'accepted') ? null : (
                        <span className="text-xs text-ink-faint">
                          add one by username first — they have to say yes
                        </span>
                      )}
                    </>
                  )}
                </div>
              ) : null}

              {rejecting ? (
                <div className="mt-3 flex flex-col gap-2 rounded-xl border border-line bg-surface/60 p-3">
                  <p className="text-xs tracking-wide text-ink-faint uppercase">
                    what is wrong with it?
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {REJECTION_REASONS.map((reason) => (
                      <button
                        key={reason}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          setRejectionReason((chosen) => (chosen === reason ? null : reason))
                        }
                        className={`rounded-full px-2.5 py-1 text-xs disabled:opacity-50 ${
                          rejectionReason === reason
                            ? 'bg-accent text-surface'
                            : 'border border-line text-ink-soft'
                        }`}
                      >
                        {reason}
                      </button>
                    ))}
                  </div>
                  <input
                    value={rejectionNote}
                    onChange={(event) => setRejectionNote(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void reject()
                    }}
                    placeholder="or say it in your own words"
                    className="w-full rounded-xl border border-line bg-surface p-2.5 text-xs outline-none focus:border-accent"
                  />
                  <div className="flex items-center gap-4 text-xs">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void reject()}
                      className="rounded-full bg-ink px-3.5 py-1.5 font-semibold text-surface disabled:opacity-40"
                    >
                      <ButtonLabel busy={busy}>{busy ? 'Marking…' : 'Mark it bad'}</ButtonLabel>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setRejecting(false)
                        setRejectionReason(null)
                        setRejectionNote('')
                      }}
                      className="quiet underline"
                    >
                      cancel
                    </button>
                  </div>
                  <p className="text-xs text-ink-faint">
                    Another move will be suggested for this Inkling, and this one goes into the
                    prompt as a correction — kept with what it was working from, so it can be looked
                    at later.
                  </p>
                </div>
              ) : null}

              <Guidance items={guidance} />
            </div>
          ) : null}

          <MoveLog
            moves={current.moves}
            onForget={() => {
              void actions.forgetMoves(current.id)
              setMoveRevision((value) => value + 1)
            }}
          />

          {currentRelated.length > 0 ? (
            <div className="mt-5 border-t border-line pt-3">
              <p className="text-xs tracking-wide text-ink-faint uppercase">related</p>
              <ul className="mt-1 flex flex-col gap-1">
                {currentRelated.map((entry_) => (
                  <li key={entry_.blip.id}>
                    <button
                      type="button"
                      onClick={() => onOpenBlip(entry_.blip.id)}
                      className="text-left text-xs text-ink-soft"
                    >
                      <span className="text-ink underline decoration-dotted">
                        {entry_.blip.title}
                      </span>{' '}
                      — {entry_.reasons.join('; ')}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {current.export?.notePath ? (
            <p className="mt-4 text-xs text-good">
              this one became a note: {current.export.notePath}
            </p>
          ) : null}

          {/* Taking the note does not finish the Inkling — you may well come back to it —
            so this sits on the card rather than replacing the card with a receipt. */}
          {exporting ? (
            <ExportNote
              blip={current}
              related={currentRelated.map((entry_) => entry_.blip)}
              provider={provider}
              onClose={() => setExporting(false)}
              onPromoted={(filename) => setLastNote({ title: current.title, path: filename })}
            />
          ) : null}
        </div>

        {round.showNext ? (
          <button
            type="button"
            {...round.handlers}
            onClick={() => round.next()}
            className={`sticky bottom-0 z-10 mt-2 -mb-2 w-full touch-none py-1 text-center text-[11px] ${
              round.pull === 'up' && round.armed ? 'font-semibold text-accent' : 'text-ink-faint'
            }`}
          >
            ▼ the next Inkling
          </button>
        ) : null}

        {/* Putting it down is about the whole card, so it marks the whole card: overlapping the
          bottom right corner of the frame, out of the way of everything you press. */}
        {!composer ? (
          /* The four are not one row of equals. Three of them ask for a move — from the app,
           from yourself, from a person — and they are centred, because they are the choice.
           Putting it down is the other thing you can do with a card, and it keeps to the right
           edge of the row rather than sitting in the middle of the choice. Centring the three
           in what is left, rather than on the screen, is what keeps "Ask a Friend" and "till
           Tuesday" from touching at 390px: there is room for one or the other. */
          <div
            className={`mt-6 flex flex-wrap items-end justify-center gap-2.5 ${
              /* A phone has the swipes, so with a move on screen the three buttons are three
                 buttons in the way of the thing they produce. With nothing on screen they are
                 the only way in, so they stay. */
              isTouch && (move || friendMove) ? 'hidden' : ''
            }`}
          >
            {move && !friendMove ? null : (
              <button
                type="button"
                onClick={generateMove}
                disabled={moveLoading}
                className="flex flex-col items-center gap-1.5 disabled:opacity-40"
              >
                <span className="circle h-12 w-12 border border-accent/40 text-lg text-accent">
                  ✦
                </span>
                <span className="text-xs font-medium text-ink">
                  <ButtonLabel busy={moveLoading}>
                    {moveLoading ? 'thinking…' : 'Generate'}
                  </ButtonLabel>
                </span>
              </button>
            )}

            {/* The one you press most, and it looks like it: the only filled, round thing in
              the row, and bigger than the others, so the thumb finds it without looking. */}
            <button
              type="button"
              onClick={() => setComposer({ move: null })}
              className="flex flex-col items-center gap-1.5"
            >
              <span className="circle circle--accent h-16 w-16 text-2xl">+</span>
              <span className="text-xs font-medium text-ink">New Move</span>
            </button>

            {socialOn && !current.demo ? (
              <button
                type="button"
                onClick={() => setAskOpen((open) => !open)}
                className="flex flex-col items-center gap-1.5"
              >
                <span className="circle h-12 w-12 border border-accent/40 text-lg text-accent">
                  ☺
                </span>
                <span className="text-xs font-medium text-accent">Ask a Friend</span>
              </button>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs">
          {PROMOTE_ENABLED ? (
            <button type="button" onClick={() => void promote()} className="quiet underline">
              promote
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setExporting((on) => !on)}
              className="quiet underline"
            >
              export
            </button>
          )}
        </div>

        <div className="mt-3 flex justify-center gap-4 text-xs">
          {/* "tomorrow / a week / a month" used to sit here, and nobody could say what they
            were for: three buttons that all did the same thing, differing only in a date
            the app is better at choosing than you are. The ✓ above says the date it picked,
            and that is the choice. Retiring covers "not for a long time". */}
        </div>

        {current.demo ? (
          <div className="mt-4 flex justify-center">
            <button type="button" onClick={() => void remove()} className="quiet text-xs underline">
              that was an example — remove it
            </button>
          </div>
        ) : null}

        {/* Deliberately nothing here while it thinks. There used to be a line saying so, which
          grew the card by a line and then shrank it again — a blank space appearing and
          leaving. The button is already saying "thinking", and it is where you pressed. */}

        {/* Here as well as on the entry screen, because this is where a suggestion is
          judged — and "the moves are bad" is worth hearing from the card that showed one. */}
        <div className="mt-3 flex justify-center">
          <Feedback
            env={feedbackEnv}
            screen="review"
            blip={current}
            move={move}
            onSend={onFeedback}
            className="text-xs text-ink-faint"
          />
        </div>

        <div className="mt-4 flex justify-center gap-5 text-xs">
          {current.status === 'retired' || current.status === 'promoted' ? (
            <button type="button" onClick={() => void revive()} className="quiet underline">
              revive — put it back in play
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming('retire')}
              className="quiet underline"
            >
              retire
            </button>
          )}
          {/* Both of these ask, in the middle of the screen. Deleting used to be a small word
            beside a small word, and retiring did not ask at all. */}
          <button type="button" onClick={() => setConfirming('delete')} className="quiet underline">
            delete
          </button>
        </div>

        {confirming === 'retire' ? (
          <Confirm
            question="Retire?"
            detail="It goes to the attic and stops coming up. You can revive it whenever you want — this is “not now”, not “not this”."
            confirmLabel="Yes, retire it"
            busy={confirmingBusy}
            onCancel={() => setConfirming(null)}
            onConfirm={() =>
              void (async () => {
                setConfirmingBusy(true)
                await retire()
                setConfirmingBusy(false)
                setConfirming(null)
              })()
            }
          />
        ) : null}

        {confirming === 'delete' ? (
          <Confirm
            question="Delete?"
            detail="It leaves the app and stops appearing anywhere. The log still holds it, but nothing will show it again."
            confirmLabel="Yes, delete it"
            tone="danger"
            busy={confirmingBusy}
            onCancel={() => setConfirming(null)}
            onConfirm={() =>
              void (async () => {
                setConfirmingBusy(true)
                await remove()
                setConfirmingBusy(false)
                setConfirming(null)
              })()
            }
          />
        ) : null}

        {lastNote ? (
          <p className="mt-3 rounded-2xl bg-canvas p-3 text-center text-xs text-good">
            “{lastNote.title}” became a note: {lastNote.path}
          </p>
        ) : null}

        {/* Putting it down, at the end of this Inkling and to the right — about the Inkling, and
            nowhere near anything else you press. It was a mark on the frame's corner, and since
            the card fills the screen, "the card's corner" was the bottom of the page. */}
        {!composer ? (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => void defer(DEFAULT_DEFERRAL)}
              title={`Put it down until ${deferDay} — it comes back then`}
              className="flex items-center gap-1.5 rounded-full border border-line bg-surface px-3 py-2 text-xs font-medium text-ink-soft"
            >
              <span aria-hidden="true">⏱</span>
              <span className="whitespace-nowrap">{deferShort}</span>
            </button>
          </div>
        ) : null}

        {promoteResults[current.id]?.ok === false ? (
          <p className="mt-2 text-center text-xs text-warn">
            could not write the note: {promoteResults[current.id]?.error}
          </p>
        ) : null}
      </div>
    </div>
  )
}
