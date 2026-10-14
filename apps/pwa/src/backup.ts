import type { BlipEvent } from '@inkling/domain'

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
