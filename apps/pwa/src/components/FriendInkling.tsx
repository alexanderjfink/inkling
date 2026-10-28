import type { AskContext, Blip, Friend, MoveSpec } from '@inkling/domain'
import { nameOf } from '@inkling/domain'
import { useState } from 'react'
import { formatAgo } from '../format'
import { Avatar } from './Avatar'
import { FriendImage } from './FriendImage'
import { Linkified } from './Linkified'
import { Suggest } from './Suggest'

/**
 * One Inkling somebody else has shared, with what is known about helping them.
 *
 * The same card in both places it is needed — a friend's own screen, and the friends round —
 * because they are the same question asked at different widths: *what is this, and is there
 * something I could suggest?* Two copies would drift, and the copy that drifts would be the
 * one somebody uses.
 *
 * It shows their words and their pictures and nothing of their schedule. What is due for them
 * is theirs; a friend being shown "overdue" is pressure by proxy.
 */
export function FriendInkling({
  friend,
  context,
  serverUrl,
  /** Their note, when this one arrived as a request for help. */
  askNote,
  /** When they asked, so a long wait is visible without a date being attached to the Inkling. */
  askedAt,
  /** One of your Inklings about the same thing, if there is one. */
  overlap,
  onOpenMine,
  onSuggest,
  onDismiss,
  /** Where "their other Inklings" goes, when there is such a place. */
  onOpenFriend,
}: {
  friend: Friend
  context: AskContext
  serverUrl: string
  askNote?: string
  askedAt?: string
  overlap?: Blip
  onOpenMine?: (id: string) => void
  onSuggest: (move: MoveSpec, note: string) => Promise<string | null>
  onDismiss?: () => void
  onOpenFriend?: () => void
}) {
  const [suggesting, setSuggesting] = useState(false)
  const [sent, setSent] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  return (
    <div
      className="rounded-2xl border p-3 text-left"
      style={{
        borderColor: friend.color ? `${friend.color}66` : undefined,
        background: friend.color ? `${friend.color}0d` : undefined,
      }}
    >
      <div className="flex items-center gap-2.5">
        <Avatar
          username={nameOf(friend)}
          userId={friend.userId}
          color={friend.color}
          hash={friend.avatar}
          size={22}
        />
        <span className="min-w-0 flex-1 truncate text-xs text-ink-soft">
          {askNote !== undefined ? `${nameOf(friend)} asked you` : nameOf(friend)}
          {askedAt ? <span className="text-ink-faint"> · {formatAgo(askedAt)}</span> : null}
        </span>
        <span className="shrink-0 rounded-full bg-surface px-2 py-0.5 text-[10px] tracking-wide text-ink-faint uppercase">
          {context.type}
        </span>
      </div>

      {askNote ? (
        <p className="mt-2 border-line border-l-2 pl-2 text-xs text-ink-soft">
          <Linkified text={askNote} />
        </p>
      ) : null}

      <p className="mt-2 text-sm font-medium">{context.title}</p>
      {context.body ? (
        <p className="mt-1 text-xs whitespace-pre-wrap text-ink-soft">
          <Linkified text={context.body} />
        </p>
      ) : null}
      {context.topics.length > 0 ? (
        <p className="mt-0.5 text-xs text-ink-faint">{context.topics.join(' · ')}</p>
      ) : null}

      {context.entries.length > 0 ? (
        <ol className="mt-2 flex flex-col gap-1">
          {context.entries.map((written, index) => (
            <li key={`${index}-${written.slice(0, 12)}`} className="flex gap-2 text-xs">
              <span aria-hidden className="mt-0.5 text-[10px] text-ink-faint">
                {index + 1}
              </span>
              <span className="min-w-0 flex-1 text-ink-soft">
                <Linkified text={written} />
              </span>
            </li>
          ))}
        </ol>
      ) : null}

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

      {/* What has already been put in front of them. Not a scoreboard — it is the one thing
          that stops a friend suggesting the same idea twice, and it says where the edges are. */}
      {context.offered.length > 0 ? (
        <p className="mt-2 text-[11px] text-ink-faint">
          already tried: {context.offered.slice(-3).join(' · ')}
        </p>
      ) : null}

      {overlap && onOpenMine ? (
        <button
          type="button"
          onClick={() => onOpenMine(overlap.id)}
          className="mt-2 block text-left text-xs text-accent"
        >
          you have one about this too — “{overlap.title}”
        </button>
      ) : null}

      {sent ? (
        <p className="mt-2 text-xs text-good">
          sent — {nameOf(friend)} will see it the next time they open Inklings
        </p>
      ) : suggesting ? (
        <Suggest
          context={context}
          onCancel={() => setSuggesting(false)}
          onSend={async (move, note) => {
            const result = await onSuggest(move, note)
            if (result === null) setSent(true)
            else setProblem(result)
            return result
          }}
        />
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setSuggesting(true)}
            className="rounded-full border border-accent/50 px-3 py-1.5 text-xs font-medium text-accent"
          >
            suggest a move
          </button>
          {onDismiss ? (
            <button type="button" onClick={onDismiss} className="quiet text-xs underline">
              not for me
            </button>
          ) : null}
          {onOpenFriend ? (
            <button type="button" onClick={onOpenFriend} className="quiet text-xs underline">
              their other Inklings
            </button>
          ) : null}
        </div>
      )}

      {problem ? <p className="mt-1 text-xs text-warn">{problem}</p> : null}
    </div>
  )
}
