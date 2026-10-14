import { access, mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { W_OK } from 'node:constants'
import { dirname, join, resolve, sep } from 'node:path'

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
  /** Vault-relative path, as the caller asked for it. */
  path: string
  created: boolean
}

export async function writeNote(
  vault: string,
  relativePath: string,
  markdown: string,
): Promise<WriteResult> {
  const full = resolveNotePath(vault, relativePath)
  if (!full) throw new Error('note path escapes the vault')

  await mkdir(dirname(full), { recursive: true })

  let created = true
  try {
    await stat(full)
    created = false
  } catch {
    // Not there yet, which is the normal case.
  }

  await writeFile(full, markdown, 'utf8')
  return { path: relativePath, created }
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
