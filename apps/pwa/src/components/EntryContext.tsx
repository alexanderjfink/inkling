import type { Entry, MoveSpec } from '@inkling/domain'
import { useState } from 'react'

/**
 * The context an entry was written in, one tap away.
 *
 * The person's own words stay the first thing you read and the only thing at full
 * contrast. This is deliberately quiet and closed by default, and it opens on *tap*
 * rather than on hover because the device this is mostly used on has no pointer — a
 * hover-only affordance is one that half the users never find.
 */
export function EntryContextPanel({ entry, move }: { entry: Entry; move?: MoveSpec }) {
  const [open, setOpen] = useState(false)
  const guidance = entry.context?.guidance ?? []
  const material = entry.context?.material
  if (!move && guidance.length === 0 && !material) return null

  return (
    <div className="mt-0.5">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? 'Hide the context for this entry' : 'Show the context for this entry'}
        className="quiet text-xs"
      >
        <span aria-hidden="true">{open ? '▾' : '▸'}</span> context
      </button>

      {open ? (
        <div className="mt-1.5 flex flex-col gap-2.5 rounded-xl border border-line bg-surface/50 p-2.5">
          {move ? (
            <div>
              <p className="text-xs tracking-wide text-ink-faint uppercase">the move</p>
              <p className="mt-0.5 text-xs text-ink-soft">{move.title}</p>
              {move.goal ? (
                <p className="mt-0.5 text-xs text-ink-faint">goal: {move.goal}</p>
              ) : null}
            </div>
          ) : null}

          {guidance.length > 0 ? (
            <div>
              <p className="text-xs tracking-wide text-ink-faint uppercase">what to look for</p>
              <ul className="mt-0.5 flex flex-col gap-1">
                {guidance.map((item) => (
                  <li key={item} className="text-xs leading-relaxed text-ink-soft">
                    · {item}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {material ? (
            <div>
              <p className="text-xs tracking-wide text-ink-faint uppercase">what it found</p>
              {material.url ? (
                <a
                  href={material.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-0.5 block text-xs text-accent underline"
                >
                  {material.title || material.url}
                </a>
              ) : (
                <p className="mt-0.5 text-xs text-ink-soft">{material.title}</p>
              )}
              {material.extract ? (
                <p className="mt-1 text-xs leading-relaxed text-ink-faint">{material.extract}</p>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
