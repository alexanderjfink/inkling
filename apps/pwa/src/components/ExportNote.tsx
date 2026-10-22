import type { Blip, LLMProvider } from '@inkling/domain'
import { draftNextSteps, noteFilename, renderObsidianNote } from '@inkling/domain'
import { useEffect, useState } from 'react'
import { ButtonLabel, Spinner } from './Spinner'
import { buttonClass, primaryButtonClass } from './SettingsBits'

/** Save, download or share the note. */
function save(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/**
 * The Inkling as a note you can keep.
 *
 * Rendered exactly as it would be written into a vault — frontmatter, what was collected,
 * the moves, what it links to — and then handed over rather than filed. The difference
 * between this and promoting is only who does the last step.
 */
export function ExportNote({
  blip,
  related,
  provider,
  onClose,
  onPromoted,
}: {
  blip: Blip
  related: Blip[]
  /** Absent means the steps are written by the heuristics, which need no model. */
  provider?: LLMProvider
  onClose: () => void
  /** Called once it has been taken, so the card can say so. */
  onPromoted: (filename: string) => void
}) {
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const filename = noteFilename(blip.title)

  // Drafted once, on open: the next steps are the only part that needs thinking about, and
  // they should be there by the time the text is read rather than arriving underneath it.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const draft = await draftNextSteps(blip, { provider, related })
      if (cancelled) return
      setMarkdown(renderObsidianNote(blip, { nextSteps: draft.steps, related }))
    })()
    return () => {
      cancelled = true
    }
    // Keyed on the Inkling: this is rendered once per open, and re-rendering it while it
    // is being read would be a note that changes under your eyes.
  }, [blip.id])

  async function copy() {
    if (!markdown) return
    setBusy(true)
    try {
      await navigator.clipboard.writeText(markdown)
      setStatus('copied — paste it wherever you like')
    } catch {
      setStatus('this browser would not let the page copy for you; select it instead')
    } finally {
      setBusy(false)
    }
  }

  async function share() {
    if (!markdown) return
    const file = new File([markdown], filename, { type: 'text/markdown' })
    try {
      // A file first, so it arrives as a note rather than as a wall of text; a phone will
      // offer Notes, Obsidian, Files, Messages or whatever else can take one.
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: blip.title })
        onPromoted(filename)
        return
      }
      await navigator.share({ title: blip.title, text: markdown })
      onPromoted(filename)
    } catch {
      // A cancelled share is not a failure, and saying so would be a lie either way.
      setStatus('sharing was cancelled')
    }
  }

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-line bg-surface/60 p-3">
      <div className="flex items-center gap-3">
        <p className="text-xs tracking-wide text-ink-faint uppercase">export to note</p>
        <button type="button" onClick={onClose} className="quiet ml-auto text-xs underline">
          close
        </button>
      </div>

      <p className="text-xs text-ink-soft">
        This is the note, rendered as it would be written — frontmatter, what you collected, the
        moves, what it links to. Take it wherever you want it.
      </p>

      {markdown === null ? (
        <p className="flex items-center gap-2 text-xs text-ink-faint">
          <Spinner className="h-3.5 w-3.5" />
          writing it out…
        </p>
      ) : (
        <>
          <pre className="max-h-72 overflow-auto rounded-xl border border-line bg-surface p-3 text-xs leading-relaxed whitespace-pre-wrap">
            {markdown}
          </pre>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                save(filename, markdown)
                onPromoted(filename)
                setStatus(`saved as ${filename}`)
              }}
              className={primaryButtonClass}
            >
              Download
            </button>
            <button
              type="button"
              onClick={() => void copy()}
              disabled={busy}
              className={buttonClass}
            >
              <ButtonLabel busy={busy}>{busy ? 'Copying…' : 'Copy'}</ButtonLabel>
            </button>
            {canShare ? (
              <button type="button" onClick={() => void share()} className={buttonClass}>
                Share
              </button>
            ) : null}
          </div>

          {status ? <p className="text-xs text-good">{status}</p> : null}
        </>
      )}
    </div>
  )
}
