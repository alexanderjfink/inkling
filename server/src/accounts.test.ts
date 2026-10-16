import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAccountManager } from './accounts'
import { Auth } from './auth'
import { createHandler } from './handler'

let dir = ''

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'inkling-accounts-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

type Handle = (request: Request) => Promise<Response>

async function harness() {
  const auth = new Auth(dir)
  const accounts = await createAccountManager(dir)
  const handle = createHandler(accounts.storeFor, {
    auth,
    accountFor: accounts.accountFor,
    serverSettings: accounts.serverSettings,
  })
  return { auth, accounts, handle }
}

const api = (path: string, init: RequestInit = {}) =>
  new Request(`http://localhost/api${path}`, init)

function authed(token: string, init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  }
}

async function setupAdmin(handle: Handle, username = 'sam', password = 'correct horse') {
  const response = await handle(
    api('/auth/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
  )
  const body = (await response.json()) as { token: string; user: { id: string; role: string } }
  return body
}

/** A JSONL line the server will accept: the deviceId must match the log being written. */
function logLine(deviceId: string, seq: number, text = 'hi'): string {
  return `${JSON.stringify({
    t: 'captured',
    id: `blip-${seq}`,
    input: { kind: 'text', text },
    type: 'idea',
    deviceId,
    seq,
    at: `2026-03-0${seq}T00:00:00Z`,
  })}\n`
}

describe('before anyone signs in', () => {
  test('the API refuses work, and says so in a way the app can act on', async () => {
    const { handle } = await harness()
    const response = await handle(api('/devices'))
    expect(response.status).toBe(401)
    expect((await response.json()).signedOut).toBe(true)
  })

  test('every data route is closed, not just the obvious one', async () => {
    const { handle } = await harness()
    const closed = [
      ['/devices', {}],
      ['/config', {}],
      ['/logs/device0001', {}],
      ['/blobs/' + 'a'.repeat(64), {}],
      ['/llm/health', {}],
      ['/admin/users', {}],
      ['/lookup', { method: 'POST', body: '{}' }],
      ['/fetch', { method: 'POST', body: '{}' }],
      ['/obsidian/status', {}],
    ] as const
    for (const [path, init] of closed) {
      const response = await handle(api(path, init))
      expect({ path, status: response.status }).toEqual({ path, status: 401 })
    }
  })

  test('health still answers, because the app and the container both need it', async () => {
    const { handle } = await harness()
    const response = await handle(api('/health'))
    expect(response.status).toBe(200)
    expect((await response.json()).ok).toBe(true)
  })

  test('state says a setup is needed, which is how the app knows what to show', async () => {
    const { handle } = await harness()
    const body = await (await handle(api('/auth/state'))).json()
    expect(body).toEqual({ accounts: true, needsSetup: true, signedOut: true, user: null })
  })

  test('a made-up token is not a session', async () => {
    const { handle } = await harness()
    const response = await handle(api('/devices', authed('not-a-real-token')))
    expect(response.status).toBe(401)
  })

  test('a token that is not a bearer token is not a session', async () => {
    const { handle, auth } = await harness()
    const { token } = await setupAdmin(handle)
    const response = await handle(api('/devices', { headers: { authorization: token } }))
    expect(response.status).toBe(401)
    expect(await auth.resolve(token)).not.toBeNull()
  })
})

describe('setup and sign in', () => {
  test('setup returns a working token, and the account is an admin', async () => {
    const { handle } = await harness()
    const { token, user } = await setupAdmin(handle)
    expect(user.role).toBe('admin')
    expect((await handle(api('/devices', authed(token)))).status).toBe(200)
  })

  test('signing in again gives a second working token', async () => {
    const { handle } = await harness()
    await setupAdmin(handle)
    const response = await handle(
      api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'sam', password: 'correct horse' }),
      }),
    )
    expect(response.status).toBe(200)
    const { token } = (await response.json()) as { token: string }
    expect((await handle(api('/devices', authed(token)))).status).toBe(200)
  })

  test('a wrong password is a 401 and gives nothing away', async () => {
    const { handle } = await harness()
    await setupAdmin(handle)
    const wrong = await handle(
      api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'sam', password: 'wrong' }),
      }),
    )
    const missing = await handle(
      api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'nobody', password: 'wrong' }),
      }),
    )
    expect(wrong.status).toBe(401)
    expect(missing.status).toBe(401)
    expect(await wrong.json()).toEqual(await missing.json())
  })

  test('setting up twice is refused, so the first visitor cannot be displaced', async () => {
    const { handle } = await harness()
    await setupAdmin(handle)
    const second = await handle(
      api('/auth/setup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'mallory', password: 'let me in please' }),
      }),
    )
    expect(second.status).toBe(400)
  })

  test('signing out stops the token working', async () => {
    const { handle } = await harness()
    const { token } = await setupAdmin(handle)
    await handle(api('/auth/logout', authed(token, { method: 'POST' })))
    expect((await handle(api('/devices', authed(token)))).status).toBe(401)
  })

  test('me reports the account, and the role the app needs to show the admin page', async () => {
    const { handle } = await harness()
    const { token } = await setupAdmin(handle)
    const body = await (await handle(api('/auth/me', authed(token)))).json()
    expect(body.user.username).toBe('sam')
    expect(body.user.role).toBe('admin')
    expect(body.user.passwordHash).toBeUndefined()
  })
})

describe('accounts do not see each other', () => {
  test('a log written by one account is invisible to another', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)
    const added = await handle(
      api(
        '/admin/users',
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
        }),
      ),
    )
    expect(added.status).toBe(200)

    const priyaLogin = await handle(
      api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
      }),
    )
    const priya = (await priyaLogin.json()) as { token: string }

    const device = 'samdevice01'
    const write = await handle(
      api(`/logs/${device}`, authed(sam.token, { method: 'PUT', body: logLine(device, 1) })),
    )
    expect(write.status).toBe(200)

    const samDevices = await (await handle(api('/devices', authed(sam.token)))).json()
    expect(samDevices.devices.map((entry: { deviceId: string }) => entry.deviceId)).toEqual([
      device,
    ])

    const priyaDevices = await (await handle(api('/devices', authed(priya.token)))).json()
    expect(priyaDevices.devices).toEqual([])

    // And Priya cannot reach Sam's log by guessing the device id.
    const stolen = await handle(api(`/logs/${device}`, authed(priya.token)))
    expect(await stolen.text()).toBe('')
    expect(stolen.headers.get('x-log-size')).toBe('0')
  })

  test('each account has its own settings', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)
    await handle(
      api(
        '/admin/users',
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
        }),
      ),
    )
    const priyaLogin = await handle(
      api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
      }),
    )
    const priya = (await priyaLogin.json()) as { token: string }

    await handle(
      api(
        '/config',
        authed(sam.token, {
          method: 'PUT',
          body: JSON.stringify({ model: 'sam-model', vault: '/tmp/sam-vault' }),
        }),
      ),
    )
    // Priya is a member, so she cannot set the model — it is the server's now, and only an
    // admin changes it. Her own settings are still hers.
    await handle(
      api(
        '/config',
        authed(priya.token, { method: 'PUT', body: JSON.stringify({ vault: '/tmp/priya-vault' }) }),
      ),
    )
    await handle(
      api(
        '/config',
        authed(sam.token, { method: 'PUT', body: JSON.stringify({ model: 'priya-model' }) }),
      ),
    )

    const samConfig = (await (await handle(api('/config', authed(sam.token)))).json()).config
    const priyaConfig = (await (await handle(api('/config', authed(priya.token)))).json()).config
    expect(samConfig.vault).toBe('/tmp/sam-vault')
    expect(priyaConfig.vault).toBe('/tmp/priya-vault')

    // The model is one thing for the server, not one thing per person: it runs on the
    // server, it holds the keys, and every account is asking the same process. So the last
    // one written wins and both accounts see it — which is the point of the change.
    expect(samConfig.model).toBe('priya-model')
    expect(priyaConfig.model).toBe('priya-model')
  })

  test('the settings files really are in separate directories', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)
    await handle(
      api(
        '/config',
        authed(sam.token, { method: 'PUT', body: JSON.stringify({ vault: '/tmp/x' }) }),
      ),
    )
    const path = join(dir, 'users', sam.user.id, 'config.json')
    expect(JSON.parse(await readFile(path, 'utf8')).vault).toBe('/tmp/x')

    // And the model is not in there at all, because it is not the account's to keep.
    expect(JSON.parse(await readFile(path, 'utf8')).model).toBeUndefined()
  })
})

describe('settings that belong to the server', () => {
  const fingerprint =
    'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99'

  test('only an admin may change what describes the server', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)
    await handle(
      api(
        '/admin/users',
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
        }),
      ),
    )
    const priyaLogin = await handle(
      api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
      }),
    )
    const priya = (await priyaLogin.json()) as { token: string }

    const refused = await handle(
      api(
        '/config',
        authed(priya.token, {
          method: 'PUT',
          body: JSON.stringify({ twaPackage: 'app.inkling.mobile' }),
        }),
      ),
    )
    expect(refused.status).toBe(403)
  })

  test('the assetlinks document follows the server setting, not the account one', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)

    const before = await handle(new Request('http://localhost/.well-known/assetlinks.json'))
    expect(before.status).toBe(404)

    await handle(
      api(
        '/config',
        authed(sam.token, {
          method: 'PUT',
          body: JSON.stringify({ twaPackage: 'app.inkling.mobile', twaFingerprint: fingerprint }),
        }),
      ),
    )

    const after = await handle(new Request('http://localhost/.well-known/assetlinks.json'))
    expect(after.status).toBe(200)
    const body = (await after.json()) as Array<{ target: { package_name: string } }>
    expect(body[0]?.target.package_name).toBe('app.inkling.mobile')

    // Readable back through the settings screen, alongside the account's own settings.
    const config = (await (await handle(api('/config', authed(sam.token)))).json()).config
    expect(config.twaPackage).toBe('app.inkling.mobile')
    expect(config.twaFingerprint).toBe(fingerprint)
  })

  test('an account can still change its own settings after a server field is refused', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)
    const response = await handle(
      api(
        '/config',
        authed(sam.token, {
          method: 'PUT',
          body: JSON.stringify({ model: 'mine', twaPackage: 'app.inkling.mobile' }),
        }),
      ),
    )
    expect(response.status).toBe(200)
    expect((await response.json()).config.model).toBe('mine')
  })
})

describe('the admin page', () => {
  test('a member cannot reach it', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)
    await handle(
      api(
        '/admin/users',
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
        }),
      ),
    )
    const priyaLogin = await handle(
      api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
      }),
    )
    const priya = (await priyaLogin.json()) as { token: string }

    const list = await handle(api('/admin/users', authed(priya.token)))
    expect(list.status).toBe(403)

    const add = await handle(
      api(
        '/admin/users',
        authed(priya.token, {
          method: 'POST',
          body: JSON.stringify({
            username: 'mallory',
            password: 'a good passphrase',
            role: 'admin',
          }),
        }),
      ),
    )
    expect(add.status).toBe(403)
  })

  test('an admin can list, add, promote, change a password and delete', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)

    const added = await handle(
      api(
        '/admin/users',
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
        }),
      ),
    )
    expect(added.status).toBe(200)
    const priya = (await added.json()).user as { id: string; role: string }
    expect(priya.role).toBe('member')

    const listed = (await (await handle(api('/admin/users', authed(sam.token)))).json()).users
    expect(listed.map((user: { username: string }) => user.username)).toEqual(['sam', 'priya'])
    expect(JSON.stringify(listed)).not.toContain('argon2')

    const promoted = await handle(
      api(
        `/admin/users/${priya.id}`,
        authed(sam.token, {
          method: 'PATCH',
          body: JSON.stringify({ role: 'admin' }),
        }),
      ),
    )
    expect(promoted.status).toBe(200)

    const changed = await handle(
      api(
        `/admin/users/${priya.id}/password`,
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ password: 'a different passphrase' }),
        }),
      ),
    )
    expect(changed.status).toBe(200)

    const signIn = await handle(
      api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'priya', password: 'a different passphrase' }),
      }),
    )
    expect(signIn.status).toBe(200)

    const removed = await handle(
      api(`/admin/users/${priya.id}`, authed(sam.token, { method: 'DELETE' })),
    )
    expect(removed.status).toBe(200)
    const left = (await (await handle(api('/admin/users', authed(sam.token)))).json()).users
    expect(left).toHaveLength(1)
  })

  test('the last admin cannot be deleted or demoted', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)
    const deleted = await handle(
      api(`/admin/users/${sam.user.id}`, authed(sam.token, { method: 'DELETE' })),
    )
    expect(deleted.status).toBe(400)
    const demoted = await handle(
      api(
        `/admin/users/${sam.user.id}`,
        authed(sam.token, {
          method: 'PATCH',
          body: JSON.stringify({ role: 'member' }),
        }),
      ),
    )
    expect(demoted.status).toBe(400)
  })

  test('deleting an account leaves its Inklings on disk and says where', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)
    const added = await handle(
      api(
        '/admin/users',
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
        }),
      ),
    )
    const priya = (await added.json()).user as { id: string }

    const removed = await handle(
      api(`/admin/users/${priya.id}`, authed(sam.token, { method: 'DELETE' })),
    )
    // One click should not be able to destroy a year of someone's notes.
    expect((await removed.json()).dataKept).toContain(priya.id)
  })
})

describe('changing your own password', () => {
  test('it needs the current one, and other devices are signed out', async () => {
    const { handle } = await harness()
    const sam = await setupAdmin(handle)
    const second = (await (
      await handle(
        api('/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username: 'sam', password: 'correct horse' }),
        }),
      )
    ).json()) as { token: string }

    const wrong = await handle(
      api(
        '/auth/password',
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ current: 'nope', password: 'a new passphrase' }),
        }),
      ),
    )
    expect(wrong.status).toBe(400)

    const changed = await handle(
      api(
        '/auth/password',
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ current: 'correct horse', password: 'a new passphrase' }),
        }),
      ),
    )
    expect(changed.status).toBe(200)

    // This device keeps working; the other one does not.
    expect((await handle(api('/devices', authed(sam.token)))).status).toBe(200)
    expect((await handle(api('/devices', authed(second.token)))).status).toBe(401)
  })
})

describe('adopting data from before accounts existed', () => {
  async function legacyLayout() {
    await mkdir(join(dir, 'logs'), { recursive: true })
    await writeFile(
      join(dir, 'logs', 'olddevice01.jsonl'),
      logLine('olddevice01', 1, 'from before'),
    )
    await mkdir(join(dir, 'blobs'), { recursive: true })
    await writeFile(join(dir, 'blobs', 'a'.repeat(64)), new Uint8Array([1, 2, 3]))
    await writeFile(
      join(dir, 'config.json'),
      JSON.stringify({
        model: 'old-model',
        vault: '/tmp/old-vault',
        twaPackage: 'app.inkling.mobile',
        twaFingerprint:
          'AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
      }),
    )
  }

  test('the first account gets the old Inklings, and they are still there', async () => {
    await legacyLayout()
    const { handle, accounts } = await harness()
    const sam = await setupAdmin(handle)

    const devices = await (await handle(api('/devices', authed(sam.token)))).json()
    expect(devices.devices.map((entry: { deviceId: string }) => entry.deviceId)).toEqual([
      'olddevice01',
    ])

    const log = await (await handle(api('/logs/olddevice01', authed(sam.token)))).text()
    expect(log).toContain('from before')

    // The model was per account before this, so it is lifted onto the server rather than
    // left behind: nobody should have to find and re-paste a key because of a change they
    // did not ask for.
    const config = (await (await handle(api('/config', authed(sam.token)))).json()).config
    expect(config.model).toBe('old-model')
    const onDisk = JSON.parse(await readFile(join(dir, 'server.json'), 'utf8'))
    expect(onDisk.model).toBe('old-model')
    expect(config.vault).toBe('/tmp/old-vault')

    expect(accounts.adopted()).toHaveLength(1)
  })

  test('the server keeps its own settings through the move', async () => {
    await legacyLayout()
    const { handle } = await harness()
    await setupAdmin(handle)
    const links = await handle(new Request('http://localhost/.well-known/assetlinks.json'))
    expect(links.status).toBe(200)
    expect(JSON.stringify(await links.json())).toContain('app.inkling.mobile')
  })

  test('a second account adopts nothing — it starts empty', async () => {
    await legacyLayout()
    const { handle, accounts } = await harness()
    const sam = await setupAdmin(handle)
    await handle(
      api(
        '/admin/users',
        authed(sam.token, {
          method: 'POST',
          body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
        }),
      ),
    )
    const priyaLogin = await handle(
      api('/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'priya', password: 'a good passphrase' }),
      }),
    )
    const priya = (await priyaLogin.json()) as { token: string }

    const devices = await (await handle(api('/devices', authed(priya.token)))).json()
    expect(devices.devices).toEqual([])
    // Only ever one adoption, which is what makes the move safe.
    expect(accounts.adopted()).toHaveLength(1)
  })

  test('with no legacy data there is nothing to adopt', async () => {
    const { handle, accounts } = await harness()
    await setupAdmin(handle)
    expect(accounts.adopted()).toEqual([])
  })

  test('a config with no logs is still adopted — model settings before any capture', async () => {
    // An earlier version keyed adoption on the logs directory existing, which stranded
    // exactly this: someone who set up their model and had not captured anything yet.
    await writeFile(join(dir, 'config.json'), JSON.stringify({ model: 'set up first' }))
    const { handle, accounts } = await harness()
    const sam = await setupAdmin(handle)

    const config = (await (await handle(api('/config', authed(sam.token)))).json()).config
    expect(config.model).toBe('set up first')
    expect(accounts.adopted()).toHaveLength(1)
  })

  test('the TWA fields are lifted out of the person config into the server one', async () => {
    await legacyLayout()
    const { handle } = await harness()

    // Readable with no session at all, before anyone has signed in — which is the whole
    // reason this cannot wait for the lazy adoption.
    const early = await handle(new Request('http://localhost/.well-known/assetlinks.json'))
    expect(early.status).toBe(200)

    const sam = await setupAdmin(handle)
    // Adoption happens on the first authenticated request: it needs somebody to adopt into.
    await handle(api('/config', authed(sam.token)))

    const links = await handle(new Request('http://localhost/.well-known/assetlinks.json'))
    expect(links.status).toBe(200)

    const own = JSON.parse(await readFile(join(dir, 'users', sam.user.id, 'config.json'), 'utf8'))
    // Both kinds of server setting leave the person's config: the TWA fields always did,
    // and the model does now that it is one thing for the whole machine.
    expect(own.model).toBeUndefined()
    expect(own.twaPackage).toBeUndefined()
    const server = JSON.parse(await readFile(join(dir, 'server.json'), 'utf8'))
    expect(server.twaPackage).toBe('app.inkling.mobile')
    expect(server.model).toBe('old-model')
  })
})

describe('a server with no accounts configured', () => {
  test('it stays open, which is what a bare bun run server is', async () => {
    // No `auth` option: the single-account behaviour the storage tests rely on.
    const { FileStore } = await import('./store')
    const handle = createHandler(new FileStore(dir))
    expect((await handle(api('/devices'))).status).toBe(200)
    const state = await (await handle(api('/auth/state'))).json()
    expect(state.accounts).toBe(false)
    expect(state.needsSetup).toBe(false)
  })
})
