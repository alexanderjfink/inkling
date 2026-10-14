/** Links back into Obsidian, for blips that became notes. */

/**
 * A URL that opens a note in Obsidian.
 *
 * The vault *name* is not the vault path — Obsidian registers a name, usually the
 * folder's own name — so it is derived from the last segment of the path.
 */
export function obsidianUri(vault: string, notePath: string): string {
  const name = vault.split('/').filter(Boolean).pop() ?? ''
  const file = notePath.replace(/\.md$/, '')
  return `obsidian://open?vault=${encodeURIComponent(name)}&file=${encodeURIComponent(file)}`
}
