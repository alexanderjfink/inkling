import type { AskContext, Blip, BlipEvent, Friend, FriendTimelineEntry } from '@inkling/domain'
import { buildFriendTimeline, nameOf } from '@inkling/domain'
import { useEffect, useMemo, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { FriendImage } from '../components/FriendImage'
import { Linkified } from '../components/Linkified'
import { ButtonLabel, Spinner } from '../components/Spinner'
import { Suggest } from '../components/Suggest'
import { formatAgo, formatShortDate } from '../format'
import type { SocialState } from '../state/useSocial'

type Filter = 'all' | 'out' | 'in'

/**
 * One friend, and everything that has passed between you.
 *
 * The history is read from this device's own log rather than asked of the server, which is
 * why it can be complete: every ask, every suggested move and every thank-you was written
 * down here in both directions when it happened. The server only ever carried the messages.
 *
 * Both directions are shown together and by default. A list of only what you asked for reads
 * as a list of favours owed; the other half — what you have done for them — is what makes it
 * a friendship rather than an invoice.
 */
export function FriendScreen({
  friend,
  social,
  serverUrl,
  events,
  blips,
  onOpenBlip,
  onAnswer,
  onUnfriended,
}: {
  friend: Friend
  social: SocialState
  /** For their pictures: they are theirs, and served only where they chose to share. */
  serverUrl: string
  events: BlipEvent[]
  blips: Blip[]
  /** Open one of your own Inklings, from an entry that is about it. */
  onOpenBlip: (id: string) => void
  /** Somebody is waiting: go where the answering happens. */
  onAnswer: () => void
  onUnfriended: () => void
}) {
  const [filter, setFilter] = useState<Filter>('all')
  const [theirInklings, setTheirInklings] = useState<AskContext[] | null>(null)
  const [suggesting, setSuggesting] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  /** Their shared Inklings, which is what there is to suggest something about. */
  useEffect(() => {
    let alive = true
    setLoading(true)
    void social
      .theirInklings(friend.userId)
      .then((list) => {
        if (alive) setTheirInklings(list)
      })
      .finally(() => {
        if (alive) setLoading(false)
      })
    return () => {
      alive = false
    }
  }, [friend.userId, social])

  /**
   * What an Inkling id was called.
   *
   * Two sources, because the two sides live in different places: your own Inklings are folded
   * from your log, and theirs arrived with the ask that named them.
   */
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

  const timeline = useMemo(
    () => buildFriendTimeline(events, friend, titles),
    [events, friend, titles],
  )

  const shown = timeline.filter((entry) => filter === 'all' || entry.direction === filter)
  const waiting = timeline.filter((entry) => entry.open).length
  const thanksToThem = timeline.filter((entry) => entry.kind === 'you-thanked').length
  const thanksFromThem = timeline.filter((entry) => entry.kind === 'they-thanked').length

  async function thank(entry: FriendTimelineEntry, moveTitle: string) {
    setBusy(entry.key)
    setProblem(null)
    try {
      setProblem(
        await social.note({
          to: friend,
          blipId: entry.blipId ?? '',
          kind: 'thanks',
          moveTitle,
          text: '🙏',
        }),
      )
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      <div className="card flex items-center gap-3 p-4">
        <Avatar
          username={nameOf(friend)}
          userId={friend.userId}
          color={friend.color}
          hash={friend.avatar}
          size={52}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-base font-semibold">{nameOf(friend)}</span>
          <span className="block text-xs text-ink-faint">
            friends since {formatShortDate(friend.at)}
          </span>
        </span>
      </div>

      {social.error || problem ? (
        <p className="rounded-2xl border border-line bg-surface/70 p-3 text-xs text-warn">
          {problem ?? social.error}
        </p>
      ) : null}

      {/* The two numbers are deliberately both here. A count of what you owe nobody is a
          score; a count each way is a record of the two of you. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-ink-soft">
        <span>
          🙏 you have thanked them <span className="font-semibold text-ink">{thanksToThem}</span>
        </span>
        <span>
          they have thanked you <span className="font-semibold text-ink">{thanksFromThem}</span>
        </span>
      </div>

      <section className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['all', 'both ways'],
              ['out', 'you → them'],
              ['in', 'them → you'],
            ] as Array<[Filter, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              className={`rounded-full px-3 py-1.5 text-xs ${
                filter === id ? 'bg-accent text-surface' : 'border border-line text-ink-soft'
              }`}
            >
              {label}
            </button>
          ))}
          {waiting > 0 ? (
            <span className="rounded-full border border-accent/50 px-3 py-1.5 text-xs text-accent">
              {waiting} waiting
            </span>
          ) : null}
        </div>

        {shown.length === 0 ? (
          <p className="text-xs text-ink-faint">
            Nothing between you yet. Ask {nameOf(friend)} for a move on one of your Inklings, or
            look at what they have been noticing and suggest one.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {shown.map((entry) => (
              <li key={entry.key}>
                <TimelineRow
                  entry={entry}
                  username={nameOf(friend)}
                  busy={busy === entry.key}
                  onThank={thank}
                  onOpenBlip={onOpenBlip}
                  onAnswer={onAnswer}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="text-xs tracking-wide text-ink-faint uppercase">
          what {nameOf(friend)} has shared
        </p>
        {loading ? (
          <p className="flex items-center gap-2 text-xs text-ink-faint">
            <Spinner className="h-3.5 w-3.5" />
            looking…
          </p>
        ) : theirInklings && theirInklings.length > 0 ? (
          theirInklings.map((context) => (
            <div
              key={context.blipId}
              className="rounded-2xl border border-line bg-surface/60 p-3 text-left"
            >
              <p className="text-sm font-medium">{context.title}</p>
              {context.body ? (
                <p className="mt-1 text-xs whitespace-pre-wrap text-ink-soft">
                  <Linkified text={context.body} />
                </p>
              ) : null}
              <p className="mt-0.5 text-xs text-ink-faint">
                {context.type}
                {context.topics.length > 0 ? ` · ${context.topics.join(' · ')}` : ''}
              </p>
              {context.entries.length > 0 ? (
                <ul className="mt-1 flex flex-col gap-0.5">
                  {context.entries.map((written) => (
                    <li key={written} className="text-xs text-ink-soft">
                      <Linkified text={written} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {/* Their pictures. Served only because the Inkling they are on was shared —
                  the same route, and the same check, as the ones in a request for help. */}
              {(context.mediaIds ?? []).length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {(context.mediaIds ?? []).map((hash) => (
                    <FriendImage
                      key={hash}
                      serverUrl={serverUrl}
                      userId={friend.userId}
                      hash={hash}
                      className="max-h-40 rounded-xl border border-line object-cover"
                    />
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  setSuggesting((current) => (current === context.blipId ? null : context.blipId))
                }
                className="mt-2 rounded-full border border-accent/50 px-3 py-1.5 text-xs font-medium text-accent"
              >
                {suggesting === context.blipId ? 'never mind' : 'suggest a move'}
              </button>
              {suggesting === context.blipId ? (
                <Suggest
                  context={context}
                  onCancel={() => setSuggesting(null)}
                  onSend={(move, note) =>
                    social.suggest({
                      to: friend,
                      askId: '',
                      blipId: context.blipId,
                      move,
                      note: note || undefined,
                    })
                  }
                />
              ) : null}
            </div>
          ))
        ) : (
          <p className="text-xs text-ink-faint">
            Nothing shared yet. Only Inklings somebody has chosen to share with friends appear here,
            and never a private one.
          </p>
        )}
      </section>

      <div className="flex justify-center border-t border-line pt-4">
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void (async () => {
              setBusy('unfriend')
              const problemText = await social.remove(friend.userId)
              setBusy(null)
              if (problemText) setProblem(problemText)
              else onUnfriended()
            })()
          }
          className="quiet text-xs underline disabled:opacity-40"
        >
          unfriend — either of you can undo this
        </button>
      </div>
    </div>
  )
}

/** One line of the history, in whichever direction it went. */
function TimelineRow({
  entry,
  username,
  busy,
  onThank,
  onOpenBlip,
  onAnswer,
}: {
  entry: FriendTimelineEntry
  username: string
  busy: boolean
  onThank: (entry: FriendTimelineEntry, moveTitle: string) => Promise<void>
  onOpenBlip: (id: string) => void
  onAnswer: () => void
}) {
  const mine = entry.direction === 'out'
  /** Whether this one is about an Inkling rather than a thank-you. */
  const named =
    entry.kind === 'you-asked' ||
    entry.kind === 'they-asked' ||
    entry.kind === 'you-sent-move' ||
    entry.kind === 'they-sent-move'

  /** The opening words, which is most of what makes this readable as a sentence. */
  const lead =
    entry.kind === 'you-asked'
      ? 'you asked them for a move on'
      : entry.kind === 'they-asked'
        ? 'they asked you for a move on'
        : entry.kind === 'you-sent-move'
          ? `you suggested “${entry.moveTitle}” for`
          : entry.kind === 'they-sent-move'
            ? `they suggested “${entry.moveTitle}” for`
            : entry.kind === 'you-thanked'
              ? `you thanked ${username}`
              : entry.kind === 'they-thanked'
                ? `${username} thanked you`
                : entry.kind === 'you-noted'
                  ? `you wrote to ${username}`
                  : `${username} wrote to you`

  return (
    <div
      className={`rounded-2xl border p-3 ${
        entry.open ? 'border-accent/40 bg-surface/60' : 'border-line bg-surface/50'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-base leading-6">{mine ? '↗' : '↘'}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            <span className="text-ink-soft">{lead} </span>
            {named ? (
              /* Only theirs to open: an Inkling they asked about, or one they sent a move
                 for, is not in your log — a link that opens nothing is worse than a name. */
              entry.kind === 'you-asked' || entry.kind === 'they-sent-move' ? (
                <button
                  type="button"
                  onClick={() => entry.blipId && onOpenBlip(entry.blipId)}
                  className="text-left font-medium underline decoration-dotted"
                >
                  {entry.title}
                </button>
              ) : (
                <span className="font-medium">{entry.title}</span>
              )
            ) : null}
          </span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            {formatAgo(entry.at)}
            {entry.open ? ' · waiting' : ''}
          </span>
        </span>
      </div>

      {/* Thanking, where thanking means something: they did something for you. One tap —
          a form asking what you are grateful for is a form nobody fills in. */}
      {entry.kind === 'they-sent-move' && entry.blipId ? (
        <div className="mt-2 flex justify-end">
          {entry.thanked ? (
            <span className="text-xs text-good">thanked 🙏</span>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onThank(entry, entry.moveTitle ?? '')}
              className="rounded-full border border-accent/50 px-3 py-1.5 text-xs font-medium text-accent disabled:opacity-40"
            >
              <ButtonLabel busy={busy}>{busy ? 'thanking…' : 'thank them 🙏'}</ButtonLabel>
            </button>
          )}
        </div>
      ) : null}

      {entry.kind === 'they-asked' && entry.open ? (
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={onAnswer}
            className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-surface"
          >
            help them
          </button>
        </div>
      ) : null}
    </div>
  )
}
