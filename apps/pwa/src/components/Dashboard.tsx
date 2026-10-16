import type { Overview } from '@inkling/domain'
import { ButtonLabel, Spinner } from './Spinner'

function Stat({ label, value, note }: { label: string; value: number | string; note?: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="w-40 shrink-0 text-xs text-ink-faint">{label}</span>
      <span className="text-sm font-medium">{value}</span>
      {note ? <span className="text-[11px] text-ink-faint">{note}</span> : null}
    </div>
  )
}

function when(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  return date.toLocaleDateString()
}

function share(part: number, whole: number): string {
  if (whole === 0) return ''
  return `${Math.round((part / whole) * 100)}%`
}

/**
 * How the app is doing, across everybody.
 *
 * Built around the two questions worth asking: is anything broken, and is anything being
 * said. The numbers are the background — the lists are the part that needs a person to
 * read it, which is why they are shown in full rather than summarised into a score.
 *
 * "Abandoned" is the number to watch. Retiring is a decision and a perfectly good outcome;
 * this counts the Inklings that keep coming back and never get written against, which is
 * what a suggestion that does not fit looks like from the outside.
 */
export function Dashboard({
  overview,
  loading,
  error,
  onRefresh,
}: {
  overview: Overview | null
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  if (!overview) {
    return (
      <div className="flex flex-col gap-3 border-b border-line pb-5">
        <div className="flex items-center gap-3">
          <p className="text-[11px] tracking-wide text-ink-faint uppercase">how it is going</p>
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="quiet ml-auto text-xs underline disabled:opacity-40"
          >
            <ButtonLabel busy={loading}>{loading ? 'reading logs…' : 'refresh'}</ButtonLabel>
          </button>
        </div>
        {error ? (
          <p className="rounded-2xl border border-line bg-surface/70 p-3 text-xs text-warn">
            {error}
          </p>
        ) : (
          <p className="flex items-center gap-2 text-xs text-ink-faint">
            <Spinner className="h-3.5 w-3.5" />
            reading every account&apos;s log…
          </p>
        )}
      </div>
    )
  }

  const { users, inklings, moves, badMoves, feedback, activity, devices, social } = overview
  const peak = Math.max(1, ...activity.map((day) => day.events))

  return (
    <div className="flex flex-col gap-4 border-b border-line pb-5">
      <div className="flex items-center gap-3">
        <p className="text-[11px] tracking-wide text-ink-faint uppercase">how it is going</p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="quiet ml-auto text-xs underline disabled:opacity-40"
        >
          <ButtonLabel busy={loading}>{loading ? 'reading logs…' : 'refresh'}</ButtonLabel>
        </button>
      </div>

      {overview.unreadable.length > 0 ? (
        <p className="rounded-2xl border border-line bg-surface/70 p-3 text-xs text-warn">
          could not read the logs for {overview.unreadable.join(', ')} — the numbers below are
          missing them
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface/60 p-3">
        <Stat
          label="accounts"
          value={users.total}
          note={`${users.admins} admin${users.admins === 1 ? '' : 's'} · ${users.joinedLast7Days} joined this week`}
        />
        <Stat label="devices seen" value={devices} />
        <div className="my-1.5 border-t border-line" />
        <Stat label="Inklings" value={inklings.total} note={`${inklings.examples} example`} />
        <Stat
          label="· in play"
          value={inklings.active}
          note={inklings.snoozed > 0 ? `${inklings.snoozed} put down` : undefined}
        />
        <Stat label="· in the attic" value={inklings.retired + inklings.promoted} />
        <Stat label="· deleted" value={inklings.deleted} />
        <Stat
          label="· written against"
          value={inklings.withEntries}
          note={share(inklings.withEntries, inklings.total)}
        />
        <Stat
          label="· abandoned"
          value={inklings.abandoned}
          note="kept coming back, never written against"
        />
        <div className="my-1.5 border-t border-line" />
        <Stat
          label="moves offered"
          value={moves.offered}
          note={`${moves.done} done · ${moves.skipped} put down · ${moves.kept} kept for later`}
        />
        <Stat
          label="· marked bad"
          value={moves.rejected}
          note={share(moves.rejected, moves.offered)}
        />
        <Stat
          label="· led somewhere"
          value={moves.done}
          note={`${share(moves.done, moves.offered)} of everything offered`}
        />
      </div>

      <div className="flex flex-col gap-1.5 rounded-2xl border border-line bg-surface/60 p-3">
        <Stat
          label="friendships"
          value={social.friendships}
          note={social.pending > 0 ? `${social.pending} request waiting` : undefined}
        />
        <Stat
          label="asks sent"
          value={social.asks}
          note={social.unanswered > 0 ? `${social.unanswered} still unanswered` : 'all answered'}
        />
        <Stat label="moves from friends" value={social.moves} />
        <Stat label="notes between them" value={social.notes} />
        <p className="mt-1 text-[11px] text-ink-faint">
          The unanswered number is the one worth watching: a question nobody answered is somebody
          who asked for help and did not get it.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-[11px] tracking-wide text-ink-faint uppercase">
          events, last {activity.length} days
        </p>
        {/* Stretch, not items-end: a percentage height needs a parent with a definite one,
            and an end-aligned child's height is its content's — which is the bar itself. */}
        <div className="flex h-16 gap-1">
          {activity.map((day) => (
            <div
              key={day.day}
              title={`${day.day}: ${day.events} events, ${day.captures} captured`}
              className="flex flex-1 flex-col justify-end"
            >
              <div
                className="w-full rounded-t bg-accent/70"
                style={{ height: `${Math.max(2, (day.events / peak) * 100)}%` }}
              />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-ink-faint">
          {activity.reduce((sum, day) => sum + day.captures, 0)} captured in this window
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] tracking-wide text-ink-faint uppercase">
          marked bad · {badMoves.length}
        </p>
        {badMoves.length === 0 ? (
          <p className="text-xs text-ink-faint">nothing yet</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {badMoves.map((row) => (
              <li
                key={`${row.user}:${row.at}:${row.move}`}
                className="rounded-2xl border border-line bg-surface/60 p-3"
              >
                <p className="text-xs font-medium">{row.move}</p>
                <p className="mt-0.5 text-[11px] text-warn">{row.reason ?? 'no reason given'}</p>
                {row.note ? (
                  <p className="mt-1 text-[11px] text-ink-soft italic">“{row.note}”</p>
                ) : null}
                <p className="mt-1 text-[11px] text-ink-faint">
                  {row.blipTitle ? `on “${row.blipTitle}”` : 'on an Inkling since deleted'}
                  {row.blipType ? ` (${row.blipType})` : ''} · {row.user} · {when(row.at)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] tracking-wide text-ink-faint uppercase">
          feedback · {feedback.length}
        </p>
        {feedback.length === 0 ? (
          <p className="text-xs text-ink-faint">nothing yet</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {feedback.map((row) => (
              <li
                key={`${row.user}:${row.at}:${row.text.slice(0, 24)}`}
                className="rounded-2xl border border-line bg-surface/60 p-3"
              >
                <p className="text-xs leading-relaxed text-ink">{row.text}</p>
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  from {row.screen}
                  {row.blipTitle ? ` · on “${row.blipTitle}”` : ''}
                  {row.move ? ` · move: “${row.move}”` : ''}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-faint">
                  {row.user} · {when(row.at)} · app {row.app} · server {row.server}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[11px] text-ink-faint">
        Read from the logs on demand, not from a running tally — so these numbers cannot drift from
        what is actually there. An Inkling&apos;s text is never included; feedback carries a title
        only, so a report can be recognised.
      </p>
    </div>
  )
}
