/**
 * A spinner, sized by the caller.
 *
 * Used inside buttons rather than replacing them, so the label stays put and only
 * the state changes. `border-current` means it inherits the button's colour, so it
 * works on the light buttons and the dark one alike.
 */
export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="loading"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}

/** Button contents: a spinner and the label, or just the label. */
export function ButtonLabel({ busy, children }: { busy: boolean; children: React.ReactNode }) {
  if (!busy) return <>{children}</>
  return (
    <span className="inline-flex items-center gap-2">
      <Spinner className="h-3.5 w-3.5" />
      {children}
    </span>
  )
}
