import { access, mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { W_OK } from 'node:constants'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'

export interface VaultConfig {
  vault: string
  folder: string
}

export function vaultConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
): VaultConfig {
  return {
    vault: env.INKLING_VAULT?.trim() || join(homedir(), 'Documents', 'Notebook'),
    folder: env.INKLING_VAULT_FOLDER?.trim() ?? 'Inkling',
  }
}

export interface VaultStatus {
  vault: string
  folder: string
  exists: boolean
  writable: boolean
}

/**
 * Resolve a note path inside the vault.
 *
 * Promotion writes into a directory the user owns, so the one thing that must not
 * happen is a path that escapes it. Returns null rather than throwing, so callers
 * can answer with a clear 400.
 */
export function resolveNotePath(vault: string, relativePath: string): string | null {
  if (!relativePath.endsWith('.md')) return null
  if (relativePath.includes('\0')) return null

  const root = resolve(vault)
  const full = resolve(root, relativePath)
  if (full !== root && !full.startsWith(root + sep)) return null
  return full
}

export interface WriteResult {
  /** Vault-relative path, which may differ from the one asked for on a collision. */
  path: string
  created: boolean
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/**
 * A free path next to the one asked for.
 *
 * Note titles are human now, so two notes can genuinely want the same name. Writing
 * over the first would destroy it, so the second becomes "Title 2" instead.
 */
async function freePath(base: string): Promise<string> {
  if (!(await isFile(base))) return base

  const dir = dirname(base)
  const extension = extname(base)
  const stem = basename(base, extension)
  for (let n = 2; n < 100; n++) {
    const candidate = join(dir, `${stem} ${n}${extension}`)
    if (!(await isFile(candidate))) return candidate
  }
  return base
}

export async function writeNote(
  vault: string,
  relativePath: string,
  markdown: string,
  options: { replace?: boolean } = {},
): Promise<WriteResult> {
  const requested = resolveNotePath(vault, relativePath)
  if (!requested) throw new Error('note path escapes the vault')

  // Re-promoting a blip writes back to its own note; a fresh title takes the next
  // free name rather than clobbering whatever is already there.
  const full = options.replace ? requested : await freePath(requested)

  await mkdir(dirname(full), { recursive: true })

  let created = true
  try {
    await stat(full)
    created = false
  } catch {
    // Not there yet, which is the normal case.
  }

  await writeFile(full, markdown, 'utf8')
  const root = resolve(vault)
  return { path: full.slice(root.length + 1), created }
}

export async function vaultStatus(config: VaultConfig): Promise<VaultStatus> {
  const root = resolve(config.vault)
  let exists = false
  try {
    exists = (await stat(root)).isDirectory()
  } catch {
    exists = false
  }

  let writable = false
  if (exists) {
    try {
      await access(root, W_OK)
      writable = true
    } catch {
      // On macOS, ~/Documents is protected: the process needs Full Disk Access, or
      // INKLING_VAULT needs to point somewhere it can write.
      writable = false
    }
  }

  return { vault: root, folder: config.folder, exists, writable }
}
