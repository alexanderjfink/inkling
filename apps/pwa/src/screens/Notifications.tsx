import type { AskContext, Friend } from '@inkling/domain'
import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Suggest } from '../components/Suggest'
import { formatAgo } from '../format'
import type { SocialState } from '../state/useSocial'

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

      {/* Notifications first, and friends one press further on. The two were the same button
          in the header — it opened whichever had something in it — which meant the way to
          your friends changed depending on whether anybody had asked you for anything. */}
      <button
        type="button"
        onClick={onOpenFriends}
        className="card flex items-center gap-3 p-4 text-left transition active:scale-[0.99]"
      >
        <span className="circle h-10 w-10 shrink-0 text-lg leading-none">☺</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Friends</span>
          <span className="block text-xs text-ink-faint">
            {social.friends.filter((friend) => friend.status === 'accepted').length} of them · who
            you can ask, and who can ask you
          </span>
        </span>
        <span className="text-ink-faint">›</span>
      </button>

      <section className="flex flex-col gap-2">
        <p className="text-xs tracking-wide text-ink-faint uppercase">
          asked for a move · {social.asks.length}
        </p>

        {social.asks.length === 0 ? (
          <p className="text-xs text-ink-faint">
            Nobody is waiting on you. When somebody asks, their Inkling turns up here — with what
            they have written about it and what has already been suggested — and you can send them
            something to do.
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
                      <span className="text-xs text-ink-faint">asked {formatAgo(ask.at)}</span>
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
    </div>
  )
}
