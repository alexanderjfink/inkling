import type { ReactNode } from 'react'

/**
 * A panel that comes up from the bottom over whatever you were doing.
 *
 * The question and the answer, in the place a phone puts them: the thing you were looking at
 * stays behind the backdrop, so you can see what you are acting on while you act on it. Tall
 * contents scroll rather than pushing the panel off the top of the screen — the export preview
 * is longer than a menu is.
 */
export function Tray({
  title,
  onClose,
  children,
}: {
  title?: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-ink/40 backdrop-blur-[2px]"
      />
      <div className="tray-in relative mx-auto flex max-h-[85dvh] w-full max-w-xl flex-col gap-2 overflow-y-auto rounded-t-3xl border border-line bg-surface p-4 pb-6 shadow-card">
        {title ? <p className="text-xs tracking-wide text-ink-faint uppercase">{title}</p> : null}
        {children}
      </div>
    </div>
  )
}
