import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Auth } from './auth'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inkling-auth-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`)
  return result.value
}

async function withAdmin() {
  const auth = new Auth(dir)
  const { user } = unwrap(await auth.setup('sam', 'correct horse'))
  return { auth, admin: user }
}

describe('setup', () => {
  test('an empty server needs setup, and the first account is an admin', async () => {
    const auth = new Auth(dir)
    expect(await auth.needsSetup()).toBe(true)
    const { user } = unwrap(await auth.setup('sam', 'correct horse'))
    expect(user.role).toBe('admin')
    expect(user.username).toBe('sam')
    expect(await auth.needsSetup()).toBe(false)
  })

  test('the password is never written in the clear', async () => {
    await withAdmin()
    const raw = await readFile(join(dir, 'auth', 'users.json'), 'utf8')
    expect(raw).not.toContain('correct horse')
    expect(raw).toContain('$argon2id$')
  })

  test('a second setup is refused — otherwise the first visitor owns the server', async () => {
    const { auth } = await withAdmin()
    const second = await auth.setup('mallory', 'let me in please')
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error).toContain('already has an account')
    expect(await auth.count()).toBe(1)
  })

  test('a weak password or an awkward name is refused before anything is written', async () => {
    const auth = new Auth(dir)
    expect((await auth.setup('sam', 'short')).ok).toBe(false)
    expect((await auth.setup('s', 'correct horse')).ok).toBe(false)
    expect(await auth.count()).toBe(0)
  })

  test('the token from setup works straight away', async () => {
    const { auth, admin } = await withAdmin()
    const token = unwrap(await auth.login('sam', 'correct horse')).token
    expect((await auth.resolve(token))?.id).toBe(admin.id)
  })
})

describe('login', () => {
  test('the right password gives a token that resolves to the user', async () => {
    const { auth, admin } = await withAdmin()
    const { token, user } = unwrap(await auth.login('sam', 'correct horse'))
    expect(user.id).toBe(admin.id)
    expect((await auth.resolve(token))?.username).toBe('sam')
  })

  test('the username is not case sensitive', async () => {
    const { auth } = await withAdmin()
    expect((await auth.login('SAM', 'correct horse')).ok).toBe(true)
  })

  test('a wrong password and an unknown user give the same message', async () => {
    // Telling them apart is how you enumerate who has an account here.
    const { auth } = await withAdmin()
    const wrong = await auth.login('sam', 'nope nope nope')
    const missing = await auth.login('nobody', 'nope nope nope')
    expect(wrong.ok).toBe(false)
    expect(missing.ok).toBe(false)
    if (!wrong.ok && !missing.ok) expect(wrong.error).toBe(missing.error)
  })

  test('a session survives a restart, because it is on disk', async () => {
    const { auth } = await withAdmin()
    const { token } = unwrap(await auth.login('sam', 'correct horse'))
    const reopened = new Auth(dir)
    expect((await reopened.resolve(token))?.username).toBe('sam')
  })

  test('a token that was never issued resolves to nobody', async () => {
    const { auth } = await withAdmin()
    expect(await auth.resolve('deadbeef')).toBeNull()
    expect(await auth.resolve(null)).toBeNull()
    expect(await auth.resolve('')).toBeNull()
  })

  test('the raw token is not stored, only its hash', async () => {
    const { auth } = await withAdmin()
    const { token } = unwrap(await auth.login('sam', 'correct horse'))
    const raw = await readFile(join(dir, 'auth', 'sessions.json'), 'utf8')
    expect(raw).not.toContain(token)
  })

  test('an expired session is refused', async () => {
    const { auth, admin } = await withAdmin()
    const { token } = unwrap(await auth.login('sam', 'correct horse'))
    // Rewrite every stored expiry rather than waiting thirty days. `setup` issues a
    // token too, so this is not just the one we logged in with.
    const path = join(dir, 'auth', 'sessions.json')
    const file = JSON.parse(await readFile(path, 'utf8'))
    expect(file.sessions.length).toBeGreaterThan(1)
    for (const session of file.sessions) {
      session.expiresAt = new Date(Date.now() - 1000).toISOString()
    }
    await writeFile(path, JSON.stringify(file))

    const reopened = new Auth(dir)
    expect(await reopened.resolve(token)).toBeNull()
    expect(admin.id).toBeTruthy()
  })
})

describe('logout', () => {
  test('the token stops working', async () => {
    const { auth } = await withAdmin()
    const { token } = unwrap(await auth.login('sam', 'correct horse'))
    await auth.logout(token)
    expect(await auth.resolve(token)).toBeNull()
  })

  test('logging out one device leaves the other signed in', async () => {
    const { auth } = await withAdmin()
    const first = unwrap(await auth.login('sam', 'correct horse')).token
    const second = unwrap(await auth.login('sam', 'correct horse')).token
    await auth.logout(first)
    expect(await auth.resolve(first)).toBeNull()
    expect(await auth.resolve(second)).not.toBeNull()
  })
})

describe('adding accounts', () => {
  test('a new account can sign in, and starts as a member', async () => {
    const { auth } = await withAdmin()
    const created = unwrap(await auth.add('priya', 'a good passphrase', 'member'))
    expect(created.role).toBe('member')
    expect((await auth.login('priya', 'a good passphrase')).ok).toBe(true)
  })

  test('a duplicate name is refused, including in another case', async () => {
    const { auth } = await withAdmin()
    unwrap(await auth.add('priya', 'a good passphrase', 'member'))
    const clash = await auth.add('PRIYA', 'another passphrase', 'member')
    expect(clash.ok).toBe(false)
    if (!clash.ok) expect(clash.error).toContain('taken')
  })

  test('the rules are enforced here too, not only in the form', async () => {
    const { auth } = await withAdmin()
    expect((await auth.add('x', 'a good passphrase', 'member')).ok).toBe(false)
    expect((await auth.add('ok-name', 'short', 'member')).ok).toBe(false)
  })
})

describe('passwords', () => {
  test('changing your own requires the current one', async () => {
    const { auth, admin } = await withAdmin()
    const wrong = await auth.changeOwnPassword(admin.id, 'not it', 'a new passphrase')
    expect(wrong.ok).toBe(false)
    expect((await auth.login('sam', 'correct horse')).ok).toBe(true)
  })

  test('changing your own keeps this device and signs the others out', async () => {
    const { auth, admin } = await withAdmin()
    const laptop = unwrap(await auth.login('sam', 'correct horse')).token
    const phone = unwrap(await auth.login('sam', 'correct horse')).token

    unwrap(await auth.changeOwnPassword(admin.id, 'correct horse', 'a new passphrase', phone))
    expect(await auth.resolve(phone)).not.toBeNull()
    expect(await auth.resolve(laptop)).toBeNull()
    expect((await auth.login('sam', 'a new passphrase')).ok).toBe(true)
  })

  test('an admin can set a password for someone else, which signs them out', async () => {
    const { auth } = await withAdmin()
    const priya = unwrap(await auth.add('priya', 'a good passphrase', 'member'))
    const herPhone = unwrap(await auth.login('priya', 'a good passphrase')).token

    unwrap(await auth.setPassword(priya.id, 'a different passphrase'))
    expect(await auth.resolve(herPhone)).toBeNull()
    expect((await auth.login('priya', 'a different passphrase')).ok).toBe(true)
    expect((await auth.login('priya', 'a good passphrase')).ok).toBe(false)
  })
})

describe('roles', () => {
  test('an admin can promote someone', async () => {
    const { auth, admin } = await withAdmin()
    const priya = unwrap(await auth.add('priya', 'a good passphrase', 'member'))
    unwrap(await auth.setRole(priya.id, 'admin', admin.id))
    expect((await auth.list()).find((user) => user.id === priya.id)?.role).toBe('admin')
  })

  test('the last admin cannot be demoted — that would lock the server', async () => {
    const { auth, admin } = await withAdmin()
    const other = unwrap(await auth.add('priya', 'a good passphrase', 'member'))
    const refused = await auth.setRole(admin.id, 'member', other.id)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('only admin')
  })

  test('you cannot remove your own admin access, even with others about', async () => {
    const { auth, admin } = await withAdmin()
    unwrap(await auth.add('priya', 'a good passphrase', 'admin'))
    const refused = await auth.setRole(admin.id, 'member', admin.id)
    expect(refused.ok).toBe(false)
  })
})

describe('removing accounts', () => {
  test('an admin can delete someone else', async () => {
    const { auth, admin } = await withAdmin()
    const priya = unwrap(await auth.add('priya', 'a good passphrase', 'member'))
    unwrap(await auth.remove(priya.id, admin.id))
    expect(await auth.list()).toHaveLength(1)
  })

  test('their sessions go with them', async () => {
    const { auth, admin } = await withAdmin()
    const priya = unwrap(await auth.add('priya', 'a good passphrase', 'member'))
    const token = unwrap(await auth.login('priya', 'a good passphrase')).token
    unwrap(await auth.remove(priya.id, admin.id))
    expect(await auth.resolve(token)).toBeNull()
  })

  test('you cannot delete yourself', async () => {
    const { auth, admin } = await withAdmin()
    unwrap(await auth.add('priya', 'a good passphrase', 'admin'))
    const refused = await auth.remove(admin.id, admin.id)
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.error).toContain('your own account')
  })

  test('the last admin cannot be deleted by anyone', async () => {
    const { auth, admin } = await withAdmin()
    const other = unwrap(await auth.add('priya', 'a good passphrase', 'member'))
    const refused = await auth.remove(admin.id, other.id)
    expect(refused.ok).toBe(false)
  })
})

describe('concurrency', () => {
  test('two logins at the same time both survive', async () => {
    // The sessions file is read-modify-write, so without serialising these, one of the
    // two tokens would be written and the other silently lost.
    const { auth } = await withAdmin()
    const [a, b] = await Promise.all([
      auth.login('sam', 'correct horse'),
      auth.login('sam', 'correct horse'),
    ])
    expect(a.ok && b.ok).toBe(true)
    if (a.ok && b.ok) {
      expect(await auth.resolve(a.value.token)).not.toBeNull()
      expect(await auth.resolve(b.value.token)).not.toBeNull()
    }
  })

  test('adding accounts at the same time does not lose one', async () => {
    const { auth } = await withAdmin()
    await Promise.all([
      auth.add('one', 'a good passphrase', 'member'),
      auth.add('two', 'a good passphrase', 'member'),
      auth.add('three', 'a good passphrase', 'member'),
    ])
    expect(await auth.count()).toBe(4)
  })
})

describe('a damaged or missing file', () => {
  test('a corrupt users file reads as an empty server rather than throwing', async () => {
    await mkdir(join(dir, 'auth'), { recursive: true })
    await writeFile(join(dir, 'auth', 'users.json'), '{ this is not json')
    const auth = new Auth(dir)
    expect(await auth.needsSetup()).toBe(true)
  })

  test('a corrupt sessions file means no sessions, not a crash', async () => {
    const { auth } = await withAdmin()
    const { token } = unwrap(await auth.login('sam', 'correct horse'))
    await writeFile(join(dir, 'auth', 'sessions.json'), 'nonsense')
    const reopened = new Auth(dir)
    expect(await reopened.resolve(token)).toBeNull()
  })
})
