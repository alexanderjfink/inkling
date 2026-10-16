/**
 * Somebody, as a colour and an initial.
 *
 * The colour is theirs — chosen once, and the same everywhere they appear. That is the whole
 * point: a suggestion you did not ask for is easier to take from a person you can picture,
 * and a name in grey capitals is not a person.
 */
export function Avatar({
  username,
  color,
  size = 32,
}: {
  username: string
  /** Their colour. Falls back to the initial alone rather than to a colour that means nothing. */
  color?: string
  size?: number
}) {
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        background: color ?? 'var(--color-ink-faint)',
        fontSize: Math.round(size * 0.42),
      }}
    >
      {username.slice(0, 1).toUpperCase()}
    </span>
  )
}
