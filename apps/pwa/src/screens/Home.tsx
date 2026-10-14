export function Home({
  waiting,
  attic,
  onAdd,
  onReview,
  onAttic,
  onSettings,
}: {
  waiting: number
  attic: number
  onAdd: () => void
  onReview: () => void
  onAttic: () => void
  onSettings: () => void
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-3">
      <div className="mb-8 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">Inkling</h1>
        <p className="mt-1 text-sm text-ink-faint">Help yourself make progress on your inklings.</p>
      </div>

      <button
        type="button"
        onClick={onAdd}
        className="card flex items-center gap-4 p-5 text-left transition active:scale-[0.99]"
      >
        <span className="circle circle--accent h-12 w-12 shrink-0 text-2xl leading-none">+</span>
        <span>
          <span className="block text-lg font-semibold">Add a blip</span>
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

      <div className="mt-8 flex items-center justify-center gap-6 text-xs">
        <button type="button" onClick={onSettings} className="quiet">
          Settings
        </button>
        {attic > 0 ? (
          <button type="button" onClick={onAttic} className="quiet">
            {attic} in the attic
          </button>
        ) : null}
      </div>
    </div>
  )
}
