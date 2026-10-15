import type { Blip, LLMProvider } from '@inkling/domain'
import { draftNextSteps, renderObsidianNote } from '@inkling/domain'
import { useCallback, useState } from 'react'
import { apiFetch } from '../api'
import type { InklingActions } from './useInkling'

export interface PromoteResult {
  ok: boolean
  path?: string
  steps?: string[]
  generatedBy?: 'llm' | 'heuristic'
  error?: string
}

function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

/**
 * Promoting a blip to an Obsidian note.
 *
 * The order matters: draft the next steps first, then render, then write. A note
 * that lands in the vault without specific next steps has only moved the ambiguity
 * somewhere else, which is the one thing promotion is supposed to end.
 *
 * The event is only appended once the file is actually on disk, so a failed write
 * leaves the blip exactly as it was.
 */
export function usePromote() {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, PromoteResult>>({})

  const promote = useCallback(
    async (
      blip: Blip,
      related: Blip[],
      options: { provider: LLMProvider; baseUrl: string; actions: InklingActions },
    ): Promise<PromoteResult> => {
      setBusyId(blip.id)
      let result: PromoteResult
      try {
        const draft = await draftNextSteps(blip, { provider: options.provider, related })
        const markdown = renderObsidianNote(blip, { nextSteps: draft.steps, related })

        const res = await apiFetch(join(options.baseUrl, '/obsidian/note'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            title: blip.title,
            markdown,
            // Re-promoting writes back to the blip's own note, rather than leaving a
            // second one beside it.
            ...(blip.export?.notePath ? { path: blip.export.notePath } : {}),
          }),
        })

        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `server said ${res.status}`)
        }

        const body = (await res.json()) as { path: string }
        await options.actions.promote(blip.id, body.path)
        result = {
          ok: true,
          path: body.path,
          steps: draft.steps,
          generatedBy: draft.generatedBy,
        }
      } catch (error) {
        result = { ok: false, error: error instanceof Error ? error.message : String(error) }
      } finally {
        setBusyId(null)
      }
      setResults((previous) => ({ ...previous, [blip.id]: result }))
      return result
    },
    [],
  )

  return { promote, busyId, results }
}
