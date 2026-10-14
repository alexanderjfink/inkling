import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHandler } from './handler'
import { FileStore } from './store'
import { resolveNotePath, vaultConfigFromEnv, vaultStatus, writeNote } from './vault'

const BASE = 'http://localhost/api'

let dir: string
let vault: string
let storeDir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inkling-vault-'))
  vault = join(dir, 'vault')
  storeDir = join(dir, 'store')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function handle() {
  return createHandler(new FileStore(storeDir), { vault: { vault, folder: 'Inkling' } })
}

describe('resolveNotePath', () => {
  test('accepts a normal note path', () => {
    expect(resolveNotePath('/tmp/vault', 'Inkling/a-note.md')).toBe('/tmp/vault/Inkling/a-note.md')
  })

  test('refuses traversal out of the vault', () => {
    expect(resolveNotePath('/tmp/vault', '../outside.md')).toBeNull()
    expect(resolveNotePath('/tmp/vault', 'Inkling/../../outside.md')).toBeNull()
    expect(resolveNotePath('/tmp/vault', '/etc/passwd')).toBeNull()
  })

  test('refuses anything that is not markdown', () => {
    expect(resolveNotePath('/tmp/vault', 'Inkling/note.txt')).toBeNull()
    expect(resolveNotePath('/tmp/vault', 'Inkling/note')).toBeNull()
  })

  test('refuses a null byte', () => {
    expect(resolveNotePath('/tmp/vault', 'Inkling/no\0te.md')).toBeNull()
  })

  test('a sibling directory with the vault as a prefix is still outside', () => {
    expect(resolveNotePath('/tmp/vault', '../vault-other/note.md')).toBeNull()
  })
})

describe('writeNote', () => {
  test('creates the folder, writes the file, and reports it as created', async () => {
    const result = await writeNote(vault, 'Inkling/my-note.md', '# hello\n')
    expect(result).toEqual({ path: 'Inkling/my-note.md', created: true })
    expect(await readFile(join(vault, 'Inkling/my-note.md'), 'utf8')).toBe('# hello\n')
  })

  test('a second write replaces it and reports that it existed', async () => {
    await writeNote(vault, 'Inkling/my-note.md', 'first')
    const result = await writeNote(vault, 'Inkling/my-note.md', 'second')
    expect(result.created).toBe(false)
    expect(await readFile(join(vault, 'Inkling/my-note.md'), 'utf8')).toBe('second')
  })

  test('refuses to escape the vault', async () => {
    await expect(writeNote(vault, '../escape.md', 'nope')).rejects.toThrow('escapes the vault')
  })
})

describe('vaultStatus', () => {
  test('reports a missing vault without throwing', async () => {
    const status = await vaultStatus({ vault: join(dir, 'nope'), folder: 'Inkling' })
    expect(status.exists).toBe(false)
    expect(status.writable).toBe(false)
  })

  test('reports an existing, writable vault', async () => {
    await writeNote(vault, 'Inkling/x.md', 'x')
    const status = await vaultStatus({ vault, folder: 'Inkling' })
    expect(status.exists).toBe(true)
    expect(status.writable).toBe(true)
    expect(status.folder).toBe('Inkling')
  })
})

describe('vaultConfigFromEnv', () => {
  test('defaults to the Notebook vault and an Inkling folder', () => {
    const config = vaultConfigFromEnv({})
    expect(config.vault.endsWith(join('Documents', 'Notebook'))).toBe(true)
    expect(config.folder).toBe('Inkling')
  })

  test('honours overrides', () => {
    const config = vaultConfigFromEnv({ INKLING_VAULT: '/tmp/notes', INKLING_VAULT_FOLDER: '' })
    expect(config.vault).toBe('/tmp/notes')
    expect(config.folder).toBe('')
  })
})

describe('obsidian routes', () => {
  test('status describes the configured vault', async () => {
    const res = await handle()(new Request(`${BASE}/obsidian/status`))
    expect(res.status).toBe(200)
    expect((await res.json()).folder).toBe('Inkling')
  })

  test('writes a note and returns its path', async () => {
    const res = await handle()(
      new Request(`${BASE}/obsidian/note`, {
        method: 'POST',
        body: JSON.stringify({ path: 'Inkling/note.md', markdown: '# hi\n' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ ok: true, path: 'Inkling/note.md', created: true })
    expect((await stat(join(vault, 'Inkling/note.md'))).isFile()).toBe(true)
  })

  test('a bare filename is placed in the configured folder', async () => {
    const res = await handle()(
      new Request(`${BASE}/obsidian/note`, {
        method: 'POST',
        body: JSON.stringify({ filename: 'my-note.md', markdown: '# hi\n' }),
      }),
    )
    expect(res.status).toBe(200)
    expect((await res.json()).path).toBe('Inkling/my-note.md')
    expect((await stat(join(vault, 'Inkling/my-note.md'))).isFile()).toBe(true)
  })

  test('rejects a filename containing a path separator', async () => {
    const res = await handle()(
      new Request(`${BASE}/obsidian/note`, {
        method: 'POST',
        body: JSON.stringify({ filename: '../escape.md', markdown: 'x' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('rejects a path that escapes the vault, and writes nothing', async () => {
    const res = await handle()(
      new Request(`${BASE}/obsidian/note`, {
        method: 'POST',
        body: JSON.stringify({ path: '../escape.md', markdown: '# nope' }),
      }),
    )
    expect(res.status).toBe(400)
    await expect(stat(join(dir, 'escape.md'))).rejects.toThrow()
  })

  test('requires both a path and markdown', async () => {
    const res = await handle()(
      new Request(`${BASE}/obsidian/note`, {
        method: 'POST',
        body: JSON.stringify({ path: 'Inkling/x.md' }),
      }),
    )
    expect(res.status).toBe(400)
  })

  test('answers 503 when no vault is configured at all', async () => {
    const bare = createHandler(new FileStore(storeDir))
    expect((await bare(new Request(`${BASE}/obsidian/status`))).status).toBe(503)
    expect(
      (
        await bare(
          new Request(`${BASE}/obsidian/note`, {
            method: 'POST',
            body: JSON.stringify({ path: 'a.md', markdown: 'x' }),
          }),
        )
      ).status,
    ).toBe(503)
  })
})
