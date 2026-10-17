import type {
  AskContext,
  Blip,
  BlipEvent,
  Friend,
  FriendTimelineEntry,
  MoveSpec,
} from '@inkling/domain'
import { buildSocialTimeline } from '@inkling/domain'
import { useMemo, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { SocialTabs } from '../components/SocialTabs'
import { Suggest } from '../components/Suggest'
import { formatAgo } from '../format'
import type { ReceivedAsk, SocialState } from '../state/useSocial'

type Direction = 'all' | 'out' | 'in'

/**
 * What has been going on.
 *
 * A timeline of everything that has passed with anyone, newest first, filtered by person and
 * by direction — rather than a list of names with a timeline behind each one. The question
 * somebody arrives with is "what has been happening", not "who are my friends": a menu of
 * names answers a question nobody asked and hides the interactions, which are the point.
 *
 * The waiting things — a move somebody sent, an ask nobody has answered — are in the timeline
 * where they happened, with their actions on them, rather than lifted into a list of their own
 * that would then have to be read alongside it.
 */
export function Notifications({
  social,
  picked,
  blips,
  events,
  onClearPicked,
  onOpenFriends,
  onOpenBlip,
}: {
  social: SocialState
  /** A friend's shared Inkling chosen from the friends screen, to suggest on unprompted. */
  picked: { friend: Friend; context: AskContext } | null
  blips: Blip[]
  events: BlipEvent[]
  onClearPicked: () => void
  onOpenFriends: () => void
  /** Open the Inkling a move landed on, which is where doing it happens. */
  onOpenBlip: (id: string) => void
}) {
  const [clearing, setClearing] = useState<string | null>(null)
  /** Which ask on the timeline is being answered, by its key. One form open at a time. */
  const [openAsk, setOpenAsk] = useState<string | null>(null)
  const [who, setWho] = useState('everyone')
  const [direction, setDirection] = useState<Direction>('all')

  const accepted = social.friends.filter((friend) => friend.status === 'accepted')
  const friendFor = (userId: string | undefined): Friend | undefined =>
    accepted.find((friend) => friend.userId === userId)
  const nameFor = (userId: string | undefined): string => friendFor(userId)?.username ?? 'a friend'

  /** What an Inkling id was called, from both sides: mine folded, theirs from the ask. */
  const titles = useMemo(() => {
    const map = new Map<string, string>()
    for (const blip of blips) map.set(blip.id, blip.title)
    for (const event of events) {
      if (event.t === 'friendAsk' && event.context) {
        map.set(event.context.blipId, event.context.title)
      }
    }
    return map
  }, [blips, events])

  const timeline = useMemo(() => buildSocialTimeline(events, titles), [events, titles])
  const shown = timeline
    .filter((entry) => who === 'everyone' || entry.userId === who)
    .filter((entry) => direction === 'all' || entry.direction === direction)

  /** An incoming ask, with everything a friend needs to suggest something specific. */
  const askFor = (entry: FriendTimelineEntry): ReceivedAsk | undefined =>
    entry.messageId ? social.asks.find((ask) => ask.messageId === entry.messageId) : undefined

  async function thank(entry: FriendTimelineEntry) {
    const friend = friendFor(entry.userId)
    if (!friend || !entry.blipId) return
    await social.note({
      to: friend,
      blipId: entry.blipId,
      kind: 'thanks',
      moveTitle: entry.moveTitle,
      text: '🙏',
    })
  }

  async function suggestWith(
    entry: FriendTimelineEntry,
    context: AskContext,
    move: MoveSpec,
    note: string,
  ): Promise<string | null> {
    const friend = friendFor(entry.userId)
    if (!friend) return 'that is no longer a friendship'
    return social.suggest({
      to: friend,
      askId: entry.messageId ?? '',
      blipId: context.blipId,
      move,
      note: note || undefined,
    })
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <SocialTabs view="notifications" onNotifications={() => {}} onFriends={onOpenFriends} />

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

      {/* Who, then what kind of thing. Both are filters on one timeline. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setWho('everyone')}
          className={`rounded-full px-3 py-1.5 text-xs whitespace-nowrap ${
            who === 'everyone'
              ? 'bg-ink font-medium text-surface'
              : 'border border-line text-ink-soft'
          }`}
        >
          everyone
        </button>
        {accepted.map((friend) => (
          <button
            key={friend.userId}
            type="button"
            onClick={() => setWho(friend.userId)}
            className={`flex items-center gap-1.5 rounded-full py-1 pr-3 pl-1 text-xs whitespace-nowrap ${
              who === friend.userId ? 'bg-accent text-surface' : 'border border-line text-ink-soft'
            }`}
          >
            <Avatar
              username={friend.username}
              userId={friend.userId}
              color={friend.color}
              hash={friend.avatar}
              size={20}
            />
            {friend.username}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {(
          [
            ['all', 'both ways'],
            ['out', 'help you gave'],
            ['in', 'help you got'],
          ] as Array<[Direction, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setDirection(id)}
            className={`rounded-full px-3 py-1.5 text-xs whitespace-nowrap ${
              direction === id ? 'bg-accent text-surface' : 'border border-line text-ink-soft'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <p className="text-xs text-ink-faint">
          {timeline.length === 0
            ? 'Nothing yet. Ask a friend for a move on one of your Inklings, or look at what they have been noticing and suggest one — it all turns up here.'
            : 'Nothing between those two yet.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {shown.map((entry) => {
            const friend = friendFor(entry.userId)
            const name = friend?.username ?? nameFor(entry.userId)
            const waiting = Boolean(entry.open)
            const ask = askFor(entry)
            const theirs = entry.kind === 'they-asked' || entry.kind === 'you-sent-move'
            const aboutAnInkling =
              entry.kind === 'you-asked' ||
              entry.kind === 'they-asked' ||
              entry.kind === 'you-sent-move' ||
              entry.kind === 'they-sent-move'

            return (
              <li
                key={entry.key}
                className={`rounded-2xl border p-3 ${
                  waiting ? 'border-accent/40 bg-surface/60' : 'border-line bg-surface/50'
                }`}
              >
                <div className="flex items-start gap-2.5">
                  <Avatar
                    username={name}
                    userId={entry.userId ?? ''}
                    color={friend?.color}
                    hash={friend?.avatar}
                    size={28}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm">
                      <span className="text-ink-soft">{say(entry, name)} </span>
                      {aboutAnInkling ? (
                        theirs || !entry.blipId ? (
                          <span className="font-medium">{entry.title}</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => entry.blipId && onOpenBlip(entry.blipId)}
                            className="text-left font-medium underline decoration-dotted"
                          >
                            {entry.title}
                          </button>
                        )
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {formatAgo(entry.at)}
                      {waiting ? ' · waiting' : ''}
                    </span>
                  </span>
                </div>

                {entry.kind === 'they-asked' ? (
                  ask && openAsk === entry.key ? (
                    <Suggest
                      context={ask.context}
                      onCancel={() => setOpenAsk(null)}
                      onSend={(move, note) => suggestWith(entry, ask.context, move, note)}
                    />
                  ) : (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => setOpenAsk(entry.key)}
                        className="rounded-full px-4 py-2.5 text-xs font-semibold text-white"
                        style={{ background: friend?.color ?? 'var(--color-ink)' }}
                      >
                        {ask ? `Suggest a move for ${name}` : 'open it on their card'}
                      </button>
                      {ask ? null : (
                        <p className="mt-1 text-xs text-ink-faint">
                          the question is answered — the Inkling is still theirs
                        </p>
                      )}
                    </div>
                  )
                ) : null}

                {entry.kind === 'they-sent-move' && entry.blipId ? (
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() => entry.blipId && onOpenBlip(entry.blipId)}
                      className="rounded-full px-4 py-2.5 text-xs font-semibold text-white"
                      style={{ background: friend?.color ?? 'var(--color-ink)' }}
                    >
                      Open it
                    </button>
                    {entry.thanked ? (
                      <span className="text-xs text-good">thanked 🙏</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void thank(entry)}
                        className="quiet text-xs underline"
                      >
                        thank them 🙏
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={clearing !== null}
                      onClick={() =>
                        void (async () => {
                          setClearing(entry.key)
                          await social.clearMove({
                            messageId: entry.messageId ?? entry.key,
                            blipId: entry.blipId ?? '',
                          })
                          setClearing(null)
                        })()
                      }
                      className="quiet text-xs underline disabled:opacity-40"
                    >
                      clear — not now
                    </button>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** The words for one thing that happened, with the person's name where one is needed. */
function say(entry: FriendTimelineEntry, name: string): string {
  // Every line names the person, because this list has more than one of them in it.
  switch (entry.kind) {
    case 'you-asked':
      return `you asked ${name} for a move on`
    case 'they-asked':
      return `${name} asked you for a move on`
    case 'you-sent-move':
      return `you suggested “${entry.moveTitle}” for their`
    case 'they-sent-move':
      return `${name} sent you a move for`
    case 'you-thanked':
      return `you thanked ${name}`
    case 'they-thanked':
      return `${name} thanked you`
    case 'you-noted':
      return `you wrote to ${name}`
    default:
      return `${name} wrote to you`
  }
}
