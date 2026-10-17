import type { Friend } from '@inkling/domain'
import { Avatar } from './Avatar'

/**
 * Who can see this, as faces.
 *
 * Overlapping, because the answer is "these people" rather than a number — and a row of
 * faces is read at a glance where a colour and a word have to be decoded. Nothing at all
 * when an Inkling is private: the absence is the message, and a row of greyed-out faces
 * would be saying something louder than the thing itself.
 */
export function FriendFaces({
  friends,
  size = 26,
  limit = 5,
}: {
  friends: Friend[]
  size?: number
  limit?: number
}) {
  if (friends.length === 0) return null

  const shown = friends.slice(0, limit)
  const extra = friends.length - shown.length

  return (
    <span className="flex items-center" aria-label={`visible to ${friends.length} friends`}>
      {shown.map((friend, index) => (
        <span
          key={friend.userId}
          // Ringed in the surface colour so an overlap reads as two faces rather than one
          // image, which is the whole trick of a stack like this.
          className="rounded-full ring-2 ring-surface"
          style={{ marginLeft: index === 0 ? 0 : -Math.round(size * 0.35) }}
          title={friend.username}
        >
          <Avatar
            userId={friend.userId}
            username={friend.username}
            color={friend.color}
            hash={friend.avatar}
            size={size}
          />
        </span>
      ))}
      {extra > 0 ? (
        <span
          className="flex items-center justify-center rounded-full bg-surface text-xs text-ink-faint ring-2 ring-surface"
          style={{ width: size, height: size, marginLeft: -Math.round(size * 0.35) }}
        >
          +{extra}
        </span>
      ) : null}
    </span>
  )
}
