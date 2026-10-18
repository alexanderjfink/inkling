import { type Friend, nameOf } from '@inkling/domain'
import { useState } from 'react'
import { Avatar } from '../components/Avatar'
import { SocialTabs } from '../components/SocialTabs'
import { ButtonLabel, Spinner } from '../components/Spinner'
import type { SocialState } from '../state/useSocial'

const field =
  'w-full rounded-2xl border border-line bg-surface p-3 text-sm outline-none focus:border-accent'

function when(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString()
}

/**
 * Who you can ask, and who can ask you.
 *
 * A request has to be accepted rather than assumed: typing somebody's username must not
 * be enough to be shown what they have been noticing. Everything else here follows from
 * that — a name that is pending is not yet a person you can ask, and removing one takes
 * away both directions at once.
 */
export function Friends({
  social,
  onOpen,
  onNotifications,
}: {
  social: SocialState
  /** Open one friend's history: what you have asked them, and what they have asked you. */
  onOpen: (friend: Friend) => void
  onNotifications: () => void
}) {
  const [username, setUsername] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  const accepted = social.friends.filter((friend) => friend.status === 'accepted')
  const incoming = social.friends.filter((friend) => friend.status === 'asked-of-you')
  const outgoing = social.friends.filter((friend) => friend.status === 'asked')

  async function run(key: string, work: () => Promise<string | null>) {
    setBusy(key)
    setProblem(null)
    try {
      setProblem(await work())
    } finally {
      setBusy(null)
    }
  }

  if (social.off) {
    return (
      <div className="flex flex-col gap-3 pb-8">
        <p className="rounded-2xl border border-line bg-surface/70 p-4 text-sm text-ink-soft">
          Social features are off for this account. Friends, asking one for a move, and notes
          between you are all switched off together — turn them back on in Settings.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <SocialTabs view="friends" onNotifications={onNotifications} onFriends={() => {}} />

      {social.error || problem ? (
        <p className="rounded-2xl border border-line bg-surface/70 p-3 text-xs text-warn">
          {problem ?? social.error}
        </p>
      ) : null}

      {incoming.length > 0 ? (
        <section className="flex flex-col gap-2">
          <p className="text-xs tracking-wide text-ink-faint uppercase">asked you</p>
          {incoming.map((friend) => (
            <div
              key={friend.userId}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface/60 p-3"
            >
              <Avatar
                username={nameOf(friend)}
                userId={friend.userId}
                color={friend.color}
                hash={friend.avatar}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{nameOf(friend)}</span>
                <span className="block text-xs text-ink-faint">
                  would like to be friends · {when(friend.at)}
                </span>
              </span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run(`a:${friend.userId}`, () => social.accept(friend.userId))}
                className="rounded-full bg-ink px-4 py-2 text-xs font-semibold text-surface disabled:opacity-40"
              >
                <ButtonLabel busy={busy === `a:${friend.userId}`}>Accept</ButtonLabel>
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run(`d:${friend.userId}`, () => social.decline(friend.userId))}
                className="quiet text-xs underline disabled:opacity-40"
              >
                no thanks
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <p className="text-xs tracking-wide text-ink-faint uppercase">
          friends · {accepted.length}
        </p>
        {accepted.length === 0 ? (
          <p className="text-xs text-ink-faint">
            nobody yet. Add somebody by their username — they have to say yes before either of you
            can see anything.
          </p>
        ) : (
          accepted.map((friend) => (
            /* The whole row opens their history: what you have asked them, what they have
               asked you, and what has passed between you. It used to be two quiet links —
               "their Inklings" and "unfriend" — which made ending a friendship a thing you
               could do by a mis-tap, and buried the interesting half. */
            <button
              key={friend.userId}
              type="button"
              onClick={() => onOpen(friend)}
              className="card flex items-center gap-3 p-3 text-left transition active:scale-[0.99]"
            >
              <Avatar
                username={nameOf(friend)}
                userId={friend.userId}
                color={friend.color}
                hash={friend.avatar}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{nameOf(friend)}</span>
                <span className="block text-xs text-ink-faint">
                  since {when(friend.at)} · tap for what has passed between you
                </span>
              </span>
              <span className="text-ink-faint">›</span>
            </button>
          ))
        )}
      </section>

      {outgoing.length > 0 ? (
        <section className="flex flex-col gap-2">
          <p className="text-xs tracking-wide text-ink-faint uppercase">waiting on them</p>
          {outgoing.map((friend) => (
            <div
              key={friend.userId}
              className="flex items-center gap-3 rounded-2xl border border-line bg-surface/60 p-3"
            >
              <span className="min-w-0 flex-1 text-sm">{nameOf(friend)}</span>
              <span className="text-xs text-ink-faint">asked {when(friend.at)}</span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run(`r:${friend.userId}`, () => social.remove(friend.userId))}
                className="quiet text-xs underline disabled:opacity-40"
              >
                withdraw
              </button>
            </div>
          ))}
        </section>
      ) : null}

      <form
        onSubmit={(event) => {
          event.preventDefault()
          const name = username.trim()
          if (!name) return
          void run('add', async () => {
            const problemText = await social.add(name)
            if (!problemText) setUsername('')
            return problemText
          })
        }}
        className="flex flex-col gap-3 border-t border-line pt-4"
      >
        <p className="text-xs tracking-wide text-ink-faint uppercase">add a friend</p>
        <input
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="their username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={field}
        />
        <button
          type="submit"
          disabled={busy !== null || username.trim().length === 0}
          className="self-start rounded-full bg-ink px-5 py-2.5 text-xs font-semibold text-surface disabled:opacity-40"
        >
          <ButtonLabel busy={busy === 'add'}>
            {busy === 'add' ? 'Asking…' : 'Ask to be friends'}
          </ButtonLabel>
        </button>
        <p className="text-xs text-ink-faint">
          They will see the request next time they open Inkling, and nothing of yours is visible
          until they accept.
        </p>
      </form>

      {social.loading ? (
        <p className="flex items-center gap-2 text-xs text-ink-faint">
          <Spinner className="h-3.5 w-3.5" />
          checking with the server…
        </p>
      ) : null}
    </div>
  )
}
