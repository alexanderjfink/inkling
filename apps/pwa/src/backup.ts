import type { Blip, BlipEvent } from '@inkling/domain'

/**
 * The escape hatch.
 *
 * The log is already the whole truth, so a backup is just its JSONL — the same
 * bytes sync moves, which means an export can be re-ingested by any device and
 * nothing about it is app-specific. If Inkling vanished tomorrow, this file is
 * still readable and still complete.
 */
export function downloadBackup(events: BlipEvent[]): void {
  const jsonl = events.map((event) => JSON.stringify(event)).join('\n')
  triggerDownload(
    `inkling-backup-${new Date().toISOString().slice(0, 10)}.jsonl`,
    `${jsonl}\n`,
    'application/x-ndjson',
  )
}

/**
 * The same data as something a person can read without this app.
 *
 * JSONL is complete but opaque; this is the version you could open in ten years in a
 * text editor and still understand. Losing the app should not mean losing the notes.
 */
export function renderMarkdownBackup(blips: Blip[], now = new Date()): string {
  const live = blips.filter((blip) => !blip.deleted)
  const attic = live.filter((blip) => blip.status === 'retired' || blip.status === 'promoted')

  const lines: string[] = [
    `# Inkling backup — ${now.toISOString().slice(0, 10)}`,
    '',
    `${live.length} Inkling${live.length === 1 ? '' : 's'}${
      attic.length > 0 ? ` · ${attic.length} in the attic` : ''
    }`,
  ]

  for (const blip of live) {
    lines.push('', '---', '')
    lines.push(`## ${blip.title || '(untitled)'}`)
    lines.push('')

    const facts = [
      blip.type,
      `created ${blip.created.slice(0, 10)}`,
      blip.status !== 'active' ? blip.status : null,
      blip.topics.length > 0 ? blip.topics.map((topic) => `#${topic}`).join(' ') : null,
    ].filter(Boolean)
    lines.push(`*${facts.join(' · ')}*`)

    if (blip.body && blip.body !== blip.title) lines.push('', blip.body)
    if (blip.input?.url) lines.push('', `<${blip.input.url}>`)

    for (const entry of blip.entries) {
      const text = entry.text ?? entry.url ?? ''
      if (!text.trim()) continue
      lines.push('', text.trim())

      // The context goes in a blockquote: it is what surrounded the entry, not
      // something the person wrote, and it should read that way in a plain file.
      const move = entry.moveId
        ? blip.moves.find((record) => record.moveId === entry.moveId)?.spec
        : undefined
      const guidance = entry.context?.guidance ?? []
      const material = entry.context?.material

      if (move || guidance.length > 0 || material) {
        lines.push('')
        if (move) lines.push(`> *prompted by:* ${move.title}`)
        if (move?.goal) lines.push(`> *goal:* ${move.goal}`)
        if (guidance.length > 0) {
          lines.push('>', '> *what to look for:*')
          for (const item of guidance) lines.push(`> - ${item}`)
        }
        if (material) {
          const link = material.url ? ` <${material.url}>` : ''
          lines.push('>', `> *found:* ${material.title}${link}`)
          if (material.extract) lines.push(`>`, `> ${material.extract}`)
        }
      }
    }

    for (const block of blip.blocks) {
      lines.push('', `### ${block.title || block.kind}`)
      if (block.kind === 'checklist') {
        for (const item of block.items) {
          if ((item.text ?? '').trim()) lines.push(`- [${item.done ? 'x' : ' '}] ${item.text}`)
        }
      } else if (block.kind === 'poll') {
        for (const item of block.items) {
          if ((item.text ?? '').trim()) lines.push(`- ${item.text} — ${item.votes ?? 0} vote(s)`)
        }
      } else if (block.kind === 'readingProgress') {
        const { current, total } = block.progress ?? { current: 0, total: 0 }
        lines.push(`${current} of ${total}`)
      } else {
        const filled = block.items.filter((item) => item.mediaId).length
        lines.push(`${filled} image(s), stored by content hash — not included here`)
      }
    }

    const done = blip.moves.filter((move) => move.outcome === 'done')
    if (done.length > 0) {
      lines.push('', '**Moves done**')
      for (const move of done) {
        lines.push(`- ${move.spec.title}${move.doneAt ? ` (${move.doneAt.slice(0, 10)})` : ''}`)
      }
    }

    if (blip.rejections.length > 0) {
      lines.push('', '**Suggestions marked bad**')
      for (const rejection of blip.rejections) {
        lines.push(
          `- ${rejection.spec.title}${rejection.reason ? ` — ${rejection.reason}` : ''} (${rejection.at.slice(0, 10)})`,
        )
      }
    }

    if (blip.export?.notePath) lines.push('', `Promoted to: ${blip.export.notePath}`)
  }

  lines.push('')
  return lines.join('\n')
}

export function downloadMarkdownBackup(blips: Blip[], now = new Date()): void {
  triggerDownload(
    `inkling-notes-${now.toISOString().slice(0, 10)}.md`,
    renderMarkdownBackup(blips, now),
    'text/markdown;charset=utf-8',
  )
}

/**
 * When a backup was last taken, so a stale one can be pointed out.
 *
 * Kept as a plain key here and read/written by the screen, so this module stays pure
 * rendering and has no opinion about where storage lives.
 */
export const BACKUP_LAST_KEY = 'backup:lastAt'

/** Days since the last backup, or null if there has never been one. */
export function daysSince(date: Date | null, now = new Date()): number | null {
  if (!date) return null
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000)
}

function triggerDownload(filename: string, body: string, type: string): void {
  const blob = new Blob([body], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Every suggestion that was marked bad, as JSONL, with the context it was made in.
 *
 * The log already contains these, but the log contains everything — and this data exists
 * for one job, which is making the next version of the suggestions better. One rejection
 * per line, flat enough to read and to load.
 */
/** The rows that export writes, split out so they can be checked without a browser. */
export function rejectionRows(blips: Blip[]): unknown[] {
  return blips.flatMap((blip) =>
    blip.rejections.map((rejection) => ({
      at: rejection.at,
      reason: rejection.reason ?? null,
      move: {
        id: rejection.moveId,
        title: rejection.spec.title,
        goal: rejection.spec.goal,
        why: rejection.spec.why,
        playbook: rejection.spec.playbook,
        generatedBy: rejection.spec.generatedBy,
        materialQuery: rejection.spec.materialQuery ?? null,
        timeLimitSec: rejection.spec.timeLimitSec,
      },
      // What the model was working from. This is the part that can change anything.
      offeredFor: rejection.context,
    })),
  )
}

export function downloadRejections(blips: Blip[]): void {
  const rows = rejectionRows(blips)
  if (rows.length === 0) return
  triggerDownload(
    `inkling-bad-suggestions-${new Date().toISOString().slice(0, 10)}.jsonl`,
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
    'application/x-ndjson',
  )
}
