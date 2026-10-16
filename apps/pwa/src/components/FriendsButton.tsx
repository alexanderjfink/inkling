/**
 * The way to friends, from wherever you are.
 *
 * It was a quiet link in the footer, which is where a thing goes to be not found — and the
 * question that proved it was somebody asking how to ask a friend for a move at all. It is
 * a button in the header now, on every screen, with the number of people waiting on you.
 */
export function FriendsButton({
  count,
  onClick,
  className = '',
}: {
  /** Friends waiting on something from you: an ask to answer, or a request to accept. */
  count: number
  onClick: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={count > 0 ? `Friends — ${count} waiting` : 'Friends'}
      className={`circle relative h-10 w-10 text-base ${className}`}
    >
      ☺
      {count > 0 ? (
        <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-surface">
          {count}
        </span>
      ) : null}
    </button>
  )
}
