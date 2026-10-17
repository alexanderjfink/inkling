import type { AskContext, Friend, MoveSpec } from '@inkling/domain'
import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ButtonLabel } from '../components/Spinner'
import type { SocialState } from '../state/useSocial'

const field =
  'w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent'

function when(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const minutes = Math.floor((Date.now() - date.getTime()) / 60_000)
  if (minutes < 2) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return date.toLocaleDateString()
}

/** What a friend is looking at when they decide what to suggest. */
function Ask({
  context,
  note,
  username,
  color,
  userId,
  hash,
  children,
}: {
  context: AskContext
  note?: string
  username: string
  color?: string
  userId: string
  hash?: string
  /** The action, inside the box rather than under it: this is one person's request, and a
   *  button floating below the card belongs to no card in particular. */
  children?: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface/60 p-3">
      {/* The friend is the first thing on it, with their initial and their name, because
          the whole point of this screen is that a person asked you — not that a card
          appeared. It used to open with the type and the name in small grey capitals, which
          reads as metadata rather than as somebody. */}
      <div className="flex items-center gap-2.5">
        <Avatar username={username} color={color} userId={userId} hash={hash} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{username}</span>
          <span className="block text-xs tracking-wide text-ink-faint uppercase">
            asked for a move · {context.type}
          </span>
        </span>
      </div>
      <p className="mt-2 text-sm font-medium">{context.title}</p>
      {context.body ? <p className="mt-1 text-xs text-ink-soft">{context.body}</p> : null}
      {context.topics.length > 0 ? (
        <p className="mt-1 text-xs text-ink-faint">{context.topics.join(' · ')}</p>
      ) : null}
      {context.entries.length > 0 ? (
        <p className="mt-1.5 text-xs text-ink-soft">
          <span className="text-ink-faint">they have written: </span>
          {context.entries.join(' / ')}
        </p>
      ) : null}
      {context.offered.length > 0 ? (
        <p className="mt-1 text-xs text-ink-faint">
          already suggested: {context.offered.join(' / ')}
        </p>
      ) : null}
      {note ? <p className="mt-2 text-xs text-accent italic">“{note}”</p> : null}
      {children}
    </div>
  )
}

/**
 * Suggesting a move for somebody else's Inkling.
 *
 * Deliberately the same three fields a move has always had — a title, a goal, and how long
 * it takes — because a friend is making the same kind of thing a playbook or a model makes,
 * and it should feel like the same kind of thing. Where to look is optional here, since a
 * person can name a page or a phrase they already know about.
 */
function Suggest({
  context,
  onSend,
  onCancel,
}: {
  context: AskContext
  onSend: (move: MoveSpec, note: string) => Promise<string | null>
  onCancel: () => void
}) {
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const [minutes, setMinutes] = useState('5')
  const [lookUp, setLookUp] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const ready = title.trim().length > 0 && goal.trim().length > 0

  async function send() {
    if (!ready || busy) return
    setBusy(true)
    setProblem(null)
    try {
      const seconds = Math.max(1, Math.min(15, Number(minutes) || 5)) * 60
      const problemText = await onSend(
        {
          id: 'friend.suggested',
          title: title.trim(),
          why: 'because a friend thought of it',
          timeLimitSec: seconds,
          goal: goal.trim(),
          playbook: 'friend',
          generatedBy: 'friend',
          ...(lookUp.trim() ? { lookUp: [lookUp.trim()] } : {}),
        },
        note.trim(),
      )
      if (problemText) setProblem(problemText)
      else onCancel()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-2xl border border-line bg-surface/40 p-3">
      <p className="text-xs tracking-wide text-ink-faint uppercase">suggest a move</p>
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="what should they do? e.g. Play one chord badly, twice"
        className={field}
      />
      <input
        value={goal}
        onChange={(event) => setGoal(event.target.value)}
        placeholder="what does done look like? e.g. one chord, both times"
        className={field}
      />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-ink-soft">
          minutes
          <input
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
            inputMode="numeric"
            className="w-16 rounded-xl border border-line bg-surface p-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <input
          value={lookUp}
          onChange={(event) => setLookUp(event.target.value)}
          placeholder="something to look up (optional)"
          className={`${field} flex-1`}
        />
      </div>
      <input
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="anything you want to say with it (optional)"
        className={field}
      />
      {problem ? <p className="text-xs text-warn">{problem}</p> : null}
      <div className="flex items-center gap-3">
        <button type="button" onClick={onCancel} className="quiet text-xs underline">
          cancel
        </button>
        <button
          type="button"
          disabled={!ready || busy}
          onClick={() => void send()}
          className="ml-auto rounded-full bg-ink px-5 py-2.5 text-xs font-semibold text-surface disabled:opacity-40"
        >
          <ButtonLabel busy={busy}>{busy ? 'Sending…' : 'Send the move'}</ButtonLabel>
        </button>
      </div>
      <p className="text-xs text-ink-faint">
        It arrives on “{context.title}” as coming from you, and pops to the top of their stack until
        they have done something with it.
      </p>
    </div>
  )
}

/**
 * What friends have asked for help with.
 *
 * The asks are read back from the log rather than kept in memory, so a question somebody
 * asked you survives a reload — which is the whole reason a received ask is written down.
 */
export function Notifications({
  social,
  picked,
  onClearPicked,
  onOpenFriends,
}: {
  social: SocialState
  /** A friend's shared Inkling chosen from the friends screen, to suggest on unprompted. */
  picked: { friend: Friend; context: AskContext } | null
  onClearPicked: () => void
  onOpenFriends: () => void
}) {
  const [openFor, setOpenFor] = useState<string | null>(null)

  const friendFor = (userId: string): Friend =>
    social.friends.find((friend) => friend.userId === userId) ?? {
      userId,
      username: 'a friend',
      status: 'accepted',
      at: new Date().toISOString(),
    }

  return (
    <div className="flex flex-col gap-5 pb-8">
      {social.off ? (
        <p className="rounded-2xl border border-line bg-surface/70 p-4 text-sm text-ink-soft">
          Social features are off for this account, so nothing is arriving from friends.
        </p>
      ) : null}

      {social.error ? (
        <p className="rounded-2xl border border-line bg-surface/70 p-3 text-xs text-warn">
          {social.error}
        </p>
      ) : null}

      {picked ? (
        <section className="flex flex-col gap-2">
          <p className="text-xs tracking-wide text-ink-faint uppercase">
            suggesting for {picked.friend.username}
          </p>
          <Ask
            context={picked.context}
            username={picked.friend.username}
            userId={picked.friend.userId}
            color={picked.friend.color}
            hash={picked.friend.avatar}
          />
          <Suggest
            context={picked.context}
            onCancel={onClearPicked}
            onSend={(move, note) =>
              social.suggest({
                to: picked.friend,
                askId: '',
                blipId: picked.context.blipId,
                move,
                note: note || undefined,
              })
            }
          />
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <p className="text-xs tracking-wide text-ink-faint uppercase">
          asked for a move · {social.asks.length}
        </p>

        {social.asks.length === 0 ? (
          <p className="text-xs text-ink-faint">
            Nobody has asked you for anything yet. When somebody does, their Inkling turns up here —
            with what they have written about it and what has already been suggested — and you can
            send them something to do.
          </p>
        ) : (
          social.asks.map((ask) => {
            const friend = friendFor(ask.userId)
            return (
              <div key={ask.messageId}>
                <Ask
                  context={ask.context}
                  note={ask.note}
                  username={ask.username}
                  color={friend.color}
                  userId={friend.userId}
                  hash={friend.avatar}
                >
                  {openFor !== ask.messageId ? (
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      {/* A button, and it says whose it is. "suggest a move" as an underline
                      beside a timestamp was findable only if you already knew it was there,
                      and it never said who you would be helping. */}
                      <button
                        type="button"
                        onClick={() => setOpenFor(ask.messageId)}
                        className="rounded-full px-4 py-2.5 text-xs font-semibold text-white"
                        style={{ background: friend.color ?? 'var(--color-ink)' }}
                      >
                        Suggest a move for {ask.username}
                      </button>
                      <span className="text-xs text-ink-faint">asked {when(ask.at)}</span>
                    </div>
                  ) : null}
                  {openFor === ask.messageId ? (
                    <Suggest
                      context={ask.context}
                      onCancel={() => setOpenFor(null)}
                      onSend={(move, note) =>
                        social.suggest({
                          to: friend,
                          askId: ask.messageId,
                          blipId: ask.context.blipId,
                          move,
                          note: note || undefined,
                        })
                      }
                    />
                  ) : null}
                </Ask>
              </div>
            )
          })
        )}
      </section>

      <button type="button" onClick={onOpenFriends} className="quiet self-start text-xs underline">
        friends — who you can ask, and who can ask you
      </button>
    </div>
  )
}
