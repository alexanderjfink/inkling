import type {
  AskContext,
  Blip,
  BlipEvent,
  Friend,
  FriendTimelineEntry,
  MoveSpec,
} from '@inkling/domain'
import { buildSocialTimeline, nameOf, seenNoticeIds } from '@inkling/domain'
import { useMemo, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { Linkified } from '../components/Linkified'
import { FriendImage } from '../components/FriendImage'
import { SocialTabs } from '../components/SocialTabs'
import { ButtonLabel } from '../components/Spinner'
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
 * Split in two, though: what is waiting on you, and everything else. Being told about
 * something and having it dealt with look identical in a single list, so answering a question
 * did nothing visible at all — it stayed exactly where it was. Answered things go to an
 * archive underneath, which is worth keeping and worth not being in the way.
 */
export function Notifications({
  social,
  picked,
  blips,
  events,
  serverUrl,
  onClearPicked,
  onOpenFriends,
  onOpenBlip,
}: {
  social: SocialState
  /** A friend's shared Inkling chosen from the friends screen, to suggest on unprompted. */
  picked: { friend: Friend; context: AskContext } | null
  blips: Blip[]
  events: BlipEvent[]
  /** For the pictures on an Inkling somebody has shared: they are theirs, not ours. */
  serverUrl: string
  onClearPicked: () => void
  onOpenFriends: () => void
  /** Open the Inkling a move landed on, which is where doing it happens. */
  /** The move to open on, when the entry is about a particular one. */
  onOpenBlip: (id: string, messageId?: string) => void
}) {
  const [openAsk, setOpenAsk] = useState<string | null>(null)
  const [clearing, setClearing] = useState<string | null>(null)
  const [who, setWho] = useState('everyone')
  const [direction, setDirection] = useState<Direction>('all')
  const [archive, setArchive] = useState<boolean | null>(null)
  const [marking, setMarking] = useState(false)

  const accepted = social.friends.filter((friend) => friend.status === 'accepted')
  const friendFor = (userId: string | undefined): Friend | undefined =>
    accepted.find((friend) => friend.userId === userId)

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

  /**
   * A move that arrived and has not been cleared, and a question of theirs nobody has
   * answered. Those are the two things actually waiting on you; the rest is the record.
   */
  const uncleared = new Set(social.moves.map((notice) => notice.messageId))
  const wantsAnswer = (entry: FriendTimelineEntry) =>
    (entry.kind === 'they-asked' && Boolean(entry.open)) ||
    (entry.kind === 'they-sent-move' && uncleared.has(entry.messageId ?? ''))
  const waitingOn = shown.filter(wantsAnswer)
  const archived = shown.filter((entry) => !wantsAnswer(entry))

  /**
   * What has been read, and what has not.
   *
   * "Seen" and "dealt with" are different things and the list has to say so: a question can be
   * read without being answered, and something that was looked at an hour ago is not new. The
   * unseen ones carry a dot and the accent border; everything else is quiet.
   */
  const seen = useMemo(() => seenNoticeIds(events), [events])
  const isNew = (entry: FriendTimelineEntry) =>
    Boolean(entry.messageId) && !seen.has(entry.messageId as string)
  const unseen = waitingOn.filter(isNew)
  const archiveOpen = archive ?? waitingOn.length === 0

  const askFor = (entry: FriendTimelineEntry): ReceivedAsk | undefined =>
    entry.messageId ? social.asks.find((ask) => ask.messageId === entry.messageId) : undefined

  const row = (entry: FriendTimelineEntry) => {
    const friend = friendFor(entry.userId)
    // What they would like to be called, falling back to the handle they signed up with.
    const name = friend ? nameOf(friend) : (entry.username ?? 'a friend')
    const ask = askFor(entry)

    return (
      <Row
        key={entry.key}
        entry={entry}
        friend={friend}
        name={name}
        serverUrl={serverUrl}
        ask={ask}
        isNew={isNew(entry)}
        open={openAsk === entry.key}
        clearing={clearing === entry.key}
        onOpenAsk={() => setOpenAsk(entry.key)}
        onCloseAsk={() => setOpenAsk(null)}
        onClear={() =>
          void (async () => {
            setClearing(entry.key)
            await social.clearMove({
              messageId: entry.messageId ?? entry.key,
              blipId: entry.blipId ?? '',
            })
            setClearing(null)
          })()
        }
        /* Looking at it, or saying thank you, is "interacted with": the notice stops being new
           even though the move is still on the Inkling, because nothing has been lost either way. */
        /* The message id goes with it: tapping "Open it" on a particular move is asking for
           that move, and the card would otherwise open on whoever has been waiting longest. */
        onOpenBlip={(id, messageId) => {
          if (entry.messageId && entry.blipId) {
            void social.clearMove({ messageId: entry.messageId, blipId: entry.blipId })
          }
          onOpenBlip(id, messageId)
        }}
        onThank={() => {
          if (!friend || !entry.blipId) return
          if (entry.messageId) {
            void social.clearMove({ messageId: entry.messageId, blipId: entry.blipId })
          }
          void social.note({
            to: friend,
            blipId: entry.blipId,
            kind: 'thanks',
            moveTitle: entry.moveTitle,
            text: '🙏',
          })
        }}
        onSuggest={(context, move, note) =>
          friend
            ? social.suggest({
                to: friend,
                askId: entry.messageId ?? '',
                blipId: context.blipId,
                move,
                note: note || undefined,
              })
            : Promise.resolve('that is no longer a friendship')
        }
      />
    )
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
            suggesting for {nameOf(picked.friend)}
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
              username={nameOf(friend)}
              userId={friend.userId}
              color={friend.color}
              hash={friend.avatar}
              size={20}
            />
            {nameOf(friend)}
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

      {unseen.length > 0 ? (
        <div className="flex items-center gap-3">
          <p className="text-xs text-ink-faint">{unseen.length} new since you last looked</p>
          <button
            type="button"
            disabled={marking}
            onClick={() =>
              void (async () => {
                setMarking(true)
                await social.markAllSeen({
                  moves: social.moves.map((notice) => ({
                    messageId: notice.messageId,
                    blipId: notice.blipId,
                  })),
                  asks: social.asks.map((ask) => ({
                    messageId: ask.messageId,
                    blipId: ask.context.blipId,
                  })),
                })
                setMarking(false)
              })()
            }
            className="quiet ml-auto text-xs underline disabled:opacity-40"
          >
            <ButtonLabel busy={marking}>mark all seen</ButtonLabel>
          </button>
        </div>
      ) : null}

      {waitingOn.length === 0 ? (
        <p className="text-xs text-ink-faint">
          {timeline.length === 0
            ? 'Nothing yet. Ask a friend for a move on one of your Inklings, or look at what they have been noticing and suggest one — it all turns up here.'
            : 'Nothing is waiting on you.'}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">{waitingOn.map(row)}</ul>
      )}

      {archived.length > 0 ? (
        <details
          open={archiveOpen}
          onToggle={(event) => setArchive((event.target as HTMLDetailsElement).open)}
          className="border-t border-line pt-3"
        >
          <summary className="cursor-pointer text-xs tracking-wide text-ink-faint uppercase">
            archive · {archived.length}
          </summary>
          <ul className="mt-2 flex flex-col gap-2">{archived.map(row)}</ul>
        </details>
      ) : null}
    </div>
  )
}

/** One thing that happened, and whatever it still asks of you. */
function Row({
  entry,
  friend,
  name,
  serverUrl,
  ask,
  isNew,
  open,
  clearing,
  onOpenAsk,
  onCloseAsk,
  onClear,
  onOpenBlip,
  onThank,
  onSuggest,
}: {
  entry: FriendTimelineEntry
  friend?: Friend
  name: string
  serverUrl: string
  ask?: ReceivedAsk
  /** Not looked at yet: the only thing in this list that gets to shout. */
  isNew: boolean
  open: boolean
  clearing: boolean
  onOpenAsk: () => void
  onCloseAsk: () => void
  onClear: () => void
  /** The move to open on, when the entry is about a particular one. */
  onOpenBlip: (id: string, messageId?: string) => void
  onThank: () => void
  onSuggest: (context: AskContext, move: MoveSpec, note: string) => Promise<string | null>
}) {
  const mine = entry.direction === 'out'
  const waiting = Boolean(entry.open)
  /** Their Inkling, which is not in this log — so no link, just the name. */
  const theirs = entry.kind === 'they-asked' || entry.kind === 'you-sent-move'
  const aboutAnInkling =
    entry.kind === 'you-asked' ||
    entry.kind === 'they-asked' ||
    entry.kind === 'you-sent-move' ||
    entry.kind === 'they-sent-move'

  return (
    <li
      className={`rounded-2xl border p-3 ${
        isNew ? 'border-accent bg-surface/70' : 'border-line bg-surface/50'
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
        {isNew ? <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" /> : null}
        <span className="min-w-0 flex-1">
          <span className="block text-sm">
            <span className="text-ink-soft">{say(entry, name)} </span>
            {aboutAnInkling ? (
              theirs || !entry.blipId ? (
                <span className="font-medium">{entry.title}</span>
              ) : (
                <button
                  type="button"
                  onClick={() => entry.blipId && onOpenBlip(entry.blipId, entry.messageId)}
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
            {mine && entry.kind === 'you-asked' && waiting ? ' · nothing back yet' : ''}
          </span>
        </span>
      </div>

      {/* What they are looking at, in full: the words they wrote, what they have already
          tried, and the pictures. Saying "they want help with a sourdough starter" and showing
          nothing else is a request to guess — and a photograph of the thing is most of what
          there is to say about it. */}
      {entry.kind === 'they-asked' && ask ? (
        <div className="mt-2 rounded-xl border border-line bg-canvas/60 p-3">
          {ask.context.body ? (
            <p className="text-xs whitespace-pre-wrap text-ink-soft">
              <Linkified text={ask.context.body} />
            </p>
          ) : null}
          {ask.context.topics.length > 0 ? (
            <p className="mt-1.5 text-xs text-ink-faint">{ask.context.topics.join(' · ')}</p>
          ) : null}
          {ask.context.entries.length > 0 ? (
            <div className="mt-1.5">
              <p className="text-xs text-ink-faint">they have written</p>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {ask.context.entries.map((written) => (
                  <li key={written} className="text-xs text-ink-soft">
                    <Linkified text={written} />
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {ask.context.offered.length > 0 ? (
            <p className="mt-1.5 text-xs text-ink-faint">
              already suggested: {ask.context.offered.join(' · ')}
            </p>
          ) : null}
          {(ask.context.mediaIds ?? []).length > 0 && entry.userId ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {(ask.context.mediaIds ?? []).map((hash) => (
                <FriendImage
                  key={hash}
                  serverUrl={serverUrl}
                  userId={entry.userId as string}
                  hash={hash}
                  className="max-h-40 rounded-xl border border-line object-cover"
                />
              ))}
            </div>
          ) : null}
          {ask.note ? <p className="mt-2 text-xs text-accent italic">“{ask.note}”</p> : null}
        </div>
      ) : null}

      {entry.kind === 'they-asked' ? (
        ask && open ? (
          <Suggest
            context={ask.context}
            onCancel={onCloseAsk}
            onSend={(move, note) => onSuggest(ask.context, move, note)}
          />
        ) : (
          /* No button when there is nothing to do. It used to offer "open it on their card",
             which opened nothing and could not: the question is answered, and the Inkling is
             theirs, in their log, on their card. */
          <div className="mt-2">
            <button
              type="button"
              onClick={onOpenAsk}
              className="rounded-full px-4 py-2.5 text-xs font-semibold text-white"
              style={{ background: friend?.color ?? 'var(--color-ink)' }}
            >
              Suggest a move for {name}
            </button>
          </div>
        )
      ) : null}

      {entry.kind === 'they-sent-move' && entry.blipId ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => entry.blipId && onOpenBlip(entry.blipId, entry.messageId)}
            className="rounded-full px-4 py-2.5 text-xs font-semibold text-white"
            style={{ background: friend?.color ?? 'var(--color-ink)' }}
          >
            Open it
          </button>
          {entry.thanked ? (
            <span className="text-xs text-good">thanked 🙏</span>
          ) : (
            <button type="button" onClick={onThank} className="quiet text-xs underline">
              thank them 🙏
            </button>
          )}
          <button
            type="button"
            disabled={clearing}
            onClick={onClear}
            className="quiet text-xs underline disabled:opacity-40"
          >
            clear — not now
          </button>
        </div>
      ) : null}
    </li>
  )
}

/** The words for one thing that happened, with the person's name where one is needed. */
function say(entry: FriendTimelineEntry, name: string): string {
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
