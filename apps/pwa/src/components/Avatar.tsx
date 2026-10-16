import { useAvatar } from '../state/useAvatar'

/**
 * Somebody, as their face or as a colour and an initial.
 *
 * The colour is theirs — chosen once, and the same everywhere they appear. The picture, when
 * there is one, replaces the initial but keeps the colour behind it, so a photo that has not
 * loaded yet still reads as the right person. That is the whole point: a suggestion you did
 * not ask for is easier to take from a person you can picture, and a name in grey capitals is
 * not a person.
 */
export function Avatar({
  userId,
  username,
  color,
  hash,
  size = 32,
}: {
  /** Whose picture to ask for. Omit for somebody who is not an account holder here. */
  userId?: string
  username: string
  /** Their colour. Falls back to grey rather than to a colour that means nothing. */
  color?: string
  /** The content hash of their picture, when they have one. */
  hash?: string
  size?: number
}) {
  const photo = useAvatar(userId, hash)

  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: color ?? 'var(--color-ink-faint)',
        fontSize: Math.round(size * 0.42),
      }}
    >
      {photo ? (
        <img src={photo} alt="" className="h-full w-full object-cover" />
      ) : (
        username.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}
