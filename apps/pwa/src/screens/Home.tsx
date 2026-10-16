export function Home({
  waiting,
  total,
  attic,
  capturedToday,
  serverWarning,
  onAdd,
  onReview,
  onAttic,
  onSettings,
}: {
  waiting: number
  total: number
  attic: number
  /** Captures made today, so a silent loss would be visible rather than assumed. */
  capturedToday: number
  /** Set when the server cannot be reached, so the app is not silently degraded. */
  serverWarning: string | null
  onAdd: () => void
  onReview: () => void
  onAttic: () => void
  onSettings: () => void
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <div className="mb-8">
        <div className="mb-4 flex justify-end">
          <button
            type="button"
            onClick={onSettings}
            aria-label="Settings"
            className="circle h-11 w-11 text-lg"
          >
            ⚙
          </button>
        </div>
        <img
          src="/icon-192.png"
          alt=""
          width={72}
          height={72}
          className="mx-auto mb-4 h-18 w-18 rounded-2xl"
        />
        <h1 className="text-center text-3xl font-semibold tracking-tight">Inkling</h1>
        <p className="mt-1 text-center text-sm text-ink-faint">
          Make Moves on your Inklings.
        </p>
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="card flex items-center gap-4 p-5 text-left transition active:scale-[0.99]"
      >
        <span className="circle circle--accent h-12 w-12 shrink-0 text-2xl leading-none">+</span>
        <span>
          <span className="block text-lg font-semibold">Add an Inkling</span>
          <span className="block text-sm text-ink-soft">
            Notice something — text, a link, a photo, or your voice
          </span>
        </span>
      </button>

      <button
        type="button"
        onClick={onReview}
        disabled={waiting === 0}
        className="card flex items-center gap-4 p-5 text-left transition active:scale-[0.99] disabled:opacity-55"
      >
        <span className="circle h-12 w-12 shrink-0 text-xl leading-none">◷</span>
        <span>
          <span className="block text-lg font-semibold">Review</span>
          <span className="block text-sm text-ink-soft">
            {waiting === 0
              ? 'nothing waiting right now'
              : `${waiting} waiting — a couple of minutes each`}
          </span>
        </span>
      </button>

      {serverWarning ? (
        <button
          type="button"
          onClick={onSettings}
          className="mt-4 rounded-2xl border border-line bg-surface/70 p-3 text-left text-xs text-warn"
        >
          ⚠ {serverWarning} — tap to fix
        </button>
      ) : null}

      {capturedToday > 0 ? (
        <p className="mt-3 text-center text-xs text-ink-faint">
          {capturedToday} captured today — all saved
        </p>
      ) : null}

      <button
        type="button"
        onClick={onAttic}
        disabled={total === 0}
        className="quiet mt-2 text-center text-xs underline disabled:no-underline disabled:opacity-50"
      >
        {total === 0
          ? 'no Inklings yet'
          : `all ${total} Inkling${total === 1 ? '' : 's'}${attic > 0 ? ` · ${attic} in the attic` : ''}`}
      </button>
    </div>
  )
}
