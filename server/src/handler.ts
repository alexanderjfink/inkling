import {
  type AskContext,
  type LLMProvider,
  type PublicUser,
  type SocialMessage,
  ASK_ENTRIES_MAX,
  NOTE_MAX,
  isRole,
  newId,
  noteFilename,
  defaultColor,
  parseLog,
  sha256Hex,
} from '@inkling/domain'
import type { Auth } from './auth'
import { BUILD } from './build'
import type { ConfigProblem, Runtime, ServerConfig } from './config'
import { assetLinks, publicConfig, validateConfig } from './config'
import { fetchPage, isFetchableUrl } from './fetchPage'
import { resolveLookUps } from './lookup'
import { resolveTranscriber, transcribe } from './transcribe'
import { buildOverview } from './overview'
import {
  type SocialStore,
  areFriends,
  friendsOf,
  sharedMediaForBlip,
  sharedMediaIds,
  ownsSharedBlip,
  readSharedInklings,
  sanitizeFriendMove,
} from './social'
import type { ModelStatus } from './provider'
import { listModelsFrom } from './provider'
import { PRESETS } from './providerConfig'
import { notBuiltPage, serveStatic } from './static'
import { type Store, isSafeDeviceId, isSafeHash } from './store'
import { type VaultConfig, resolveNotePath, vaultStatus, writeNote } from './vault'

const encoder = new TextEncoder()

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Permissive CORS: this is a personal server the PWA may reach on another origin. */
function withCors(headers: Headers): Headers {
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, HEAD, PUT, POST, PATCH, DELETE, OPTIONS')
  headers.set('access-control-allow-headers', 'content-type, authorization')
  return headers
}

/**
 * The session token, if the request carries one.
 *
 * A bearer header rather than a cookie: the app can be served from a different origin
 * (the Android build is), where a cookie would be a third-party cookie and quietly
 * dropped. The cost is that the token is readable by script on the page, which is
 * acceptable for a self-hosted tool on your own network and not acceptable in general.
 */
function bearer(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(.+)$/i.exec(header.trim())
  return match?.[1]?.trim() || null
}

/**
 * Where an account's data lives.
 *
 * A single `Store` means everyone shares one — which is what a server without user
 * management is, and what the storage tests want. A function is what production
 * passes, so each account gets its own logs, blobs and settings.
 */
export type StoreSource = Store | ((userId: string) => Store)

function resolveStore(source: StoreSource, userId: string): Store {
  return typeof source === 'function' ? source(userId) : source
}

/** The Digital Asset Links document, from the server's own settings. */
async function assetLinksFor(options: HandlerOptions): Promise<unknown[] | null> {
  const bridge = options.serverSettings ?? options.settings
  if (!bridge) return null
  const { config } = await bridge.read()
  return assetLinks(config)
}

/** BodyInit wants a concretely-typed ArrayBuffer, so copy into a fresh one. */
function toBody(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(copy).set(bytes)
  return copy
}

function providerList() {
  return PRESETS.map((preset) => ({
    id: preset.id,
    name: preset.name,
    kind: preset.kind,
    keyEnv: preset.keyEnv,
    baseUrl: preset.baseUrl,
    defaultModel: preset.defaultModel,
    keyOptional: Boolean(preset.keyOptional),
    noEmbeddings: Boolean(preset.noEmbeddings),
    note: preset.note ?? null,
  }))
}

/** Read the known settings fields out of a request body. */
function configPatch(body: Record<string, unknown>): ServerConfig {
  const patch: ServerConfig = {}
  const target = patch as Record<string, unknown>
  for (const key of [
    'provider',
    'model',
    'embedProvider',
    'embedModel',
    'vault',
    'folder',
    'baseUrl',
    'embedBaseUrl',
    'twaPackage',
    'twaFingerprint',
    'apiKey',
    'embedApiKey',
    'transcribeProvider',
    'transcribeModel',
    'transcribeBaseUrl',
  ] as const) {
    const value = body[key]
    if (typeof value === 'string') target[key] = value.trim()
  }
  // Booleans and one-word choices, which are neither strings nor numbers. They were
  // missing here, so the social settings saved nothing at all — a form that appears to
  // work and silently discards what you told it.
  if (typeof body.socialEnabled === 'boolean') target.socialEnabled = body.socialEnabled
  if (body.shareDefault === 'friends' || body.shareDefault === 'private') {
    target.shareDefault = body.shareDefault
  }
  const similarity = body.embedSimilarity
  if (similarity === null) {
    target.embedSimilarity = null
  } else if (typeof similarity === 'number') {
    target.embedSimilarity = similarity
  } else if (typeof similarity === 'string' && similarity.trim() !== '') {
    const parsed = Number(similarity)
    if (Number.isFinite(parsed)) target.embedSimilarity = parsed
  }
  return patch
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = (await request.json()) as unknown
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * The sync API.
 *
 *   GET  /api/health
 *   GET  /api/devices
 *   GET  /api/logs/:deviceId?offset=N     -> JSONL bytes past N
 *   PUT  /api/logs/:deviceId              -> append JSONL (device's own log only)
 *   HEAD /api/blobs/:hash                 -> existence
 *   GET  /api/blobs/:hash
 *   PUT  /api/blobs/:hash                 -> content-addressed, hash verified
 */
/** Reads and writes the saved settings, rebuilding the runtime on change. */
export interface SettingsBridge {
  read: () => Promise<{ config: ServerConfig; runtime: Runtime }>
  update: (
    patch: ServerConfig,
  ) => Promise<{ config: ServerConfig; runtime: Runtime; problems: ConfigProblem[] }>
}

/** Everything that differs between accounts: their model, their vault, their keys. */
export interface AccountContext {
  runtime: Runtime
  settings?: SettingsBridge
}

export interface HandlerOptions {
  llm?: LLMProvider
  /** Serves embeddings when set; otherwise the main provider is asked. */
  embed?: LLMProvider
  model?: ModelStatus
  vault?: VaultConfig
  /**
   * Read on every request, so the settings screen can change the model and vault
   * without restarting the server. A getter rather than an object, because
   * replacing the object would leave the handler holding the stale one.
   */
  runtime?: () => Runtime
  settings?: SettingsBridge
  /**
   * With accounts, the runtime and settings above come from here instead, per user.
   * Called on every request so a settings change takes effect immediately.
   */
  accountFor?: (user: PublicUser) => Promise<AccountContext> | AccountContext
  /**
   * Settings that belong to the server rather than to a person: the TWA package name
   * and fingerprint, which describe one APK pointing at one server.
   */
  serverSettings?: SettingsBridge
  /** When set, every route except the public ones requires a session. */
  auth?: Auth
  /** Directory of the built PWA. When set, the server serves the app itself. */
  staticDir?: string
  /**
   * Friends and the postbox between them. Absent means the social routes are not served
   * at all, which is what a server with no data directory to put them in looks like.
   */
  social?: SocialStore
}

/** Routes that must work before anyone has signed in. */
function isPublic(path: string): boolean {
  if (path === '/health') return true
  if (path === '/auth/state') return true
  if (path === '/auth/setup') return true
  if (path === '/auth/login') return true
  return false
}

/**
 * The TWA package name and fingerprint describe one APK pointing at one server, so
 * they belong to the server rather than to a person. Everything else on the settings
 * screen is per account.
 */
/**
 * Which settings describe the server rather than the person signed in.
 *
 * The model is here now, and that is the point of the change: it runs on the server, it
 * holds the keys, and every account is asking the same process. A per-account copy of a
 * server-wide fact was two places to change one thing, and it let anybody with an account
 * point the server at an address of their choosing.
 *
 * The vault stays per account: a note goes into one person's folder, not everybody's.
 */
/** A picture, not a photo library. Big enough for a face, small enough to serve inline. */
const MAX_AVATAR = 512 * 1024

const SERVER_FIELDS = new Set([
  'twaPackage',
  'twaFingerprint',
  'provider',
  'model',
  'embedProvider',
  'embedModel',
  'embedSimilarity',
  'baseUrl',
  'embedBaseUrl',
  'apiKey',
  'embedApiKey',
  'transcribeProvider',
  'transcribeModel',
  'transcribeBaseUrl',
  'transcribeApiKey',
])

function isServerField(key: string): boolean {
  return SERVER_FIELDS.has(key)
}

function splitPatch(patch: ServerConfig): { server: ServerConfig; account: ServerConfig } {
  const server: ServerConfig = {}
  const account: ServerConfig = {}
  for (const [key, value] of Object.entries(patch)) {
    Object.assign(isServerField(key) ? server : account, { [key]: value })
  }
  return { server, account }
}

function str(body: Record<string, unknown> | null, key: string): string {
  const value = body?.[key]
  return typeof value === 'string' ? value : ''
}

/** Health, and the three things you can do before you have an account. */
async function handlePublic(
  path: string,
  request: Request,
  options: HandlerOptions,
): Promise<Response> {
  if (path === '/health') {
    return json({ ok: true, service: 'inkling', build: BUILD, time: new Date().toISOString() })
  }

  const auth = options.auth
  if (!auth) {
    // A server with no accounts at all. The app uses this to decide whether to show a
    // login screen, so it must answer rather than 401.
    return json({ accounts: false, needsSetup: false, signedOut: false, user: null })
  }

  if (path === '/auth/state') {
    const user = await auth.resolve(bearer(request))
    return json({
      accounts: true,
      needsSetup: await auth.needsSetup(),
      signedOut: user === null,
      user,
    })
  }

  if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)

  if (path === '/auth/setup') {
    const body = await readJson(request)
    const result = await auth.setup(str(body, 'username'), str(body, 'password'))
    if (!result.ok) return json({ error: result.error }, 400)
    return json({ token: result.value.token, user: result.value.user })
  }

  if (path === '/auth/login') {
    const body = await readJson(request)
    const result = await auth.login(str(body, 'username'), str(body, 'password'))
    // The same 401 for a wrong password and an unknown name, so the response cannot
    // be used to find out who has an account here.
    if (!result.ok) return json({ error: result.error }, 401)
    return json({ token: result.value.token, user: result.value.user })
  }

  return json({ error: 'not found' }, 404)
}

/** The account routes: anything a signed-in person may do to their own account. */
async function handleAccount(
  path: string,
  request: Request,
  user: PublicUser,
  auth: Auth,
  token: string | null,
  storeSource: StoreSource,
  social: SocialStore | undefined,
  config: ServerConfig,
): Promise<Response | null> {
  if (path === '/social' || path.startsWith('/social/')) {
    if (!social) return json({ error: 'social features are not available here' }, 404)
    return handleSocial(path, request, user, auth, social, storeSource, config)
  }
  if (path === '/auth/me') return json({ user })

  if (path === '/auth/logout' && request.method === 'POST') {
    await auth.logout(token)
    return json({ ok: true })
  }

  /**
   * Somebody's picture.
   *
   * Readable by anyone signed in, which on a personal server is the people you know. It has
   * to be readable by them: a friend's suggestion is easier to take from a face, and the
   * picture lives on whichever account put it there.
   */
  if (path.startsWith('/avatar/') && request.method === 'GET') {
    const owner = path.slice('/avatar/'.length)
    const wanted = (await auth.list()).find((entry) => entry.id === owner)?.avatar
    if (!wanted || !isSafeHash(wanted)) return new Response('not found', { status: 404 })
    const bytes = await resolveStore(storeSource, owner).getBlob(wanted)
    if (!bytes) return new Response('not found', { status: 404 })
    return new Response(new Uint8Array(bytes).buffer, {
      headers: { 'content-type': 'image/webp', 'cache-control': 'private, max-age=3600' },
    })
  }

  // A picture of you, put there by you.
  if (path === '/auth/avatar' && request.method === 'PUT') {
    let bytes: Uint8Array | null = null
    try {
      const form = await request.formData()
      const file = form.get('avatar')
      if (file instanceof Blob && file.size > 0 && file.size <= MAX_AVATAR) {
        bytes = new Uint8Array(await file.arrayBuffer())
      }
    } catch {
      bytes = null
    }
    if (!bytes) return json({ error: 'that picture did not arrive, or is too big' }, 400)

    const hash = await sha256Hex(bytes)
    await resolveStore(storeSource, user.id).putBlob(hash, bytes)
    const saved = await auth.setAvatar(user.id, hash)
    if (!saved.ok) return json({ error: saved.error }, 400)
    return json({ user: { ...user, avatar: hash } })
  }

  if (path === '/auth/avatar' && request.method === 'DELETE') {
    await auth.setAvatar(user.id, null)
    return json({ user })
  }

  // How you appear to friends. Yours to set, and only yours.
  if (path === '/auth/color' && request.method === 'POST') {
    const body = await readJson(request)
    const wanted = body && typeof body.color === 'string' ? body.color : null
    const result = await auth.setColor(user.id, wanted)
    if (!result.ok) return json({ error: result.error }, 400)
    return json({ user: { ...user, color: wanted ?? undefined } })
  }

  if (path === '/auth/password' && request.method === 'POST') {
    const body = await readJson(request)
    const result = await auth.changeOwnPassword(
      user.id,
      str(body, 'current'),
      str(body, 'password'),
      token ?? undefined,
    )
    if (!result.ok) return json({ error: result.error }, 400)
    return json({ ok: true })
  }

  if (path === '/admin' || path.startsWith('/admin/')) {
    if (user.role !== 'admin') return json({ error: 'admins only' }, 403)
    return handleAdmin(path, request, user, auth, storeSource)
  }

  return null
}

/** Admin routes. The caller has already checked the role. */
async function handleAdmin(
  path: string,
  request: Request,
  actor: PublicUser,
  auth: Auth,
  storeSource: StoreSource,
): Promise<Response> {
  const rest = path
    .slice('/admin/'.length)
    .split('/')
    .filter((part) => part.length > 0)

  /**
   * How the app is actually doing, across everybody.
   *
   * Read from the logs on demand rather than kept as a running tally: the logs are the
   * only thing guaranteed to be there, and a counter beside them would be a second
   * source of truth free to disagree with the first.
   */
  if (rest.length === 1 && rest[0] === 'overview' && request.method === 'GET') {
    const users = await auth.list()
    return json(
      await buildOverview(
        users.map((user) => ({ user, store: resolveStore(storeSource, user.id) })),
      ),
    )
  }

  if (rest.length === 1 && rest[0] === 'users') {
    if (request.method === 'GET') return json({ users: await auth.list() })

    if (request.method === 'POST') {
      const body = await readJson(request)
      const role = isRole(body?.role) ? body.role : 'member'
      const result = await auth.add(str(body, 'username'), str(body, 'password'), role)
      if (!result.ok) return json({ error: result.error }, 400)
      return json({ user: result.value })
    }

    return json({ error: 'method not allowed' }, 405)
  }

  if (rest.length === 2 && rest[0] === 'users') {
    const id = rest[1] ?? ''

    if (request.method === 'DELETE') {
      const result = await auth.remove(id, actor.id)
      if (!result.ok) return json({ error: result.error }, 400)
      // Their Inklings are left on disk on purpose. Deleting an account should not be
      // able to destroy a year of someone's notes in one click.
      return json({ ok: true, dataKept: `data/users/${id}` })
    }

    if (request.method === 'PATCH') {
      const body = await readJson(request)
      if (!isRole(body?.role)) return json({ error: 'invalid role' }, 400)
      const result = await auth.setRole(id, body.role, actor.id)
      if (!result.ok) return json({ error: result.error }, 400)
      return json({ ok: true })
    }

    return json({ error: 'method not allowed' }, 405)
  }

  if (
    rest.length === 3 &&
    rest[0] === 'users' &&
    rest[2] === 'password' &&
    request.method === 'POST'
  ) {
    const body = await readJson(request)
    const result = await auth.setPassword(rest[1] ?? '', str(body, 'password'))
    if (!result.ok) return json({ error: result.error }, 400)
    return json({ ok: true })
  }

  return json({ error: 'not found' }, 404)
}

export function createHandler(
  storeSource: StoreSource,
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const { llm, embed, model: status, vault } = options
  return async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.startsWith('/api') ? url.pathname.slice(4) : url.pathname
    const parts = path.split('/').filter((part) => part.length > 0)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: withCors(new Headers()) })
    }

    // Anything that is not the API is the app itself, when it has been built. This has
    // to come before the session check: the login screen is part of that app.
    if (!url.pathname.startsWith('/api')) {
      if (url.pathname === '/.well-known/assetlinks.json') {
        const links = await assetLinksFor(options)
        if (!links) {
          return json(
            {
              error: 'not configured',
              hint: 'Set the TWA package name and signing fingerprint in the app: Home → ⚙ → Settings.',
            },
            404,
          )
        }
        return json(links)
      }
      if (options.staticDir) {
        const file = await serveStatic(options.staticDir, url.pathname)
        if (file) return file
      } else if (url.pathname === '/' || url.pathname === '/index.html') {
        return notBuiltPage()
      }
      return json({ error: 'not found' }, 404)
    }

    if (isPublic(path)) {
      return handlePublic(path, request, options)
    }

    // Everything below here needs an account. Without `auth` configured the server is
    // single-account, which is what a bare `bun run server` and the tests use.
    const token = bearer(request)
    const user = options.auth ? await options.auth.resolve(token) : null
    if (options.auth && !user) {
      return json({ error: 'sign in first', signedOut: true }, 401)
    }

    const account = user && options.accountFor ? await options.accountFor(user) : null
    const store = resolveStore(storeSource, user?.id ?? '')
    // Re-read on every request when a runtime was supplied, so settings changes
    // take effect immediately.
    const live = account?.runtime ?? options.runtime?.() ?? { llm, embed, status, vault }
    const settingsBridge = account?.settings ?? options.settings
    // Read once per request: the social toggle and the sharing default both live here,
    // and a settings change should take effect on the next request rather than a restart.
    const liveConfig = settingsBridge ? (await settingsBridge.read()).config : {}

    if (user && options.auth) {
      const accountRoute = await handleAccount(
        path,
        request,
        user,
        options.auth,
        token,
        storeSource,
        options.social,
        liveConfig,
      )
      if (accountRoute) return accountRoute
    }

    if (parts.length === 1 && parts[0] === 'health') {
      return json({ ok: true, service: 'inkling', time: new Date().toISOString() })
    }

    if (parts.length === 1 && parts[0] === 'devices') {
      return json({ devices: await store.devices() })
    }

    if (parts.length === 1 && parts[0] === 'digests') {
      return json({ digests: await store.digests() })
    }

    if (parts.length === 2 && parts[0] === 'llm' && parts[1] === 'health') {
      const configured = live.status?.configured ?? (live.llm ? await live.llm.available() : false)
      return json({
        configured,
        provider: live.status?.provider ?? (configured ? live.llm?.name : null) ?? null,
        providerName: live.status?.providerName ?? null,
        model: live.status?.model ?? null,
        embedModel: live.status?.embedModel ?? null,
        embedProvider: live.status?.embedProvider ?? null,
        embedProviderName: live.status?.embedProviderName ?? null,
        embedSimilarity: live.status?.embedSimilarity ?? null,
        embeddings: live.status?.embeddings ?? false,
        keySource: live.status?.keySource ?? null,
        baseUrl: live.status?.baseUrl ?? null,
        embedBaseUrl: live.status?.embedBaseUrl ?? null,
        build: BUILD,
        note: live.status?.note ?? null,
      })
    }

    if (parts.length === 2 && parts[0] === 'llm' && parts[1] === 'providers') {
      return json({ providers: providerList() })
    }

    // What the provider says it can serve, so the model field can offer a list.
    if (parts.length === 2 && parts[0] === 'llm' && parts[1] === 'models') {
      const asked = url.searchParams.get('kind')
      const kind = asked === 'embed' ? 'embed' : asked === 'transcribe' ? 'transcribe' : 'chat'

      /**
       * The transcription server is a different machine, and its own question.
       *
       * Whisper and Parakeet servers are not chat servers: Ollama has no audio endpoint at
       * all. Asking the chat provider for the list of models you can transcribe with is why
       * there was no whisper in the dropdown — it was never asked the right server.
       */
      if (kind === 'transcribe') {
        // The transcriber describes the server, not the person asking about it, so it is read
        // from the server's own settings — the same place the chat model's are read from —
        // rather than from the account's copy, which is why the address was saved and still
        // not seen here.
        const serverBridge = options.serverSettings ?? options.settings
        const serverConfig = serverBridge ? (await serverBridge.read()).config : liveConfig
        const base = (serverConfig.transcribeBaseUrl ?? '').trim().replace(/\/+$/, '')
        if (!base) {
          return json({ error: 'no transcription server set — put its address in first' }, 503)
        }
        const headers: Record<string, string> = serverConfig.transcribeApiKey
          ? { authorization: `Bearer ${serverConfig.transcribeApiKey}` }
          : {}
        try {
          return json({
            models: await listModelsFrom(`${base}/models`, headers, 'the transcriber'),
          })
        } catch (error) {
          return json(
            { error: error instanceof Error ? error.message : 'could not list models' },
            502,
          )
        }
      }

      const provider = kind === 'embed' ? (live.embed ?? live.llm) : live.llm
      if (!provider) return json({ error: 'no model configured' }, 503)
      if (!provider.listModels) return json({ error: 'this provider cannot list models' }, 501)
      try {
        return json({ models: await provider.listModels() })
      } catch (error) {
        return json(
          { error: error instanceof Error ? error.message : 'could not list models' },
          502,
        )
      }
    }

    // One real round trip, so "does this actually work?" has an answer.
    if (
      parts.length === 2 &&
      parts[0] === 'llm' &&
      parts[1] === 'test' &&
      request.method === 'POST'
    ) {
      const body = await readJson(request)
      const kind = body?.kind === 'embed' ? 'embed' : 'chat'
      const provider = kind === 'embed' ? (live.embed ?? live.llm) : live.llm
      if (!provider || !(await provider.available())) {
        return json({ ok: false, error: 'no model configured for this' })
      }

      const started = Date.now()
      try {
        if (kind === 'embed') {
          const vectors = await provider.embed(['a short test'])
          return json({
            ok: true,
            ms: Date.now() - started,
            detail: `${vectors[0]?.length ?? 0}-dimension vector`,
          })
        }
        const text = await provider.completeStructured({
          system: 'You reply with JSON only.',
          prompt: 'Reply with exactly {"ok":true}',
        })
        return json({ ok: true, ms: Date.now() - started, detail: text.slice(0, 200) })
      } catch (error) {
        return json({
          ok: false,
          ms: Date.now() - started,
          error: error instanceof Error ? error.message : 'the model call failed',
        })
      }
    }

    if (parts.length === 2 && parts[0] === 'digests') {
      const deviceId = parts[1]
      if (!deviceId || !isSafeDeviceId(deviceId)) return json({ error: 'invalid device id' }, 400)
      if (request.method === 'PUT') {
        const digest = (await request.text()).trim()
        if (!/^[a-f0-9]{64}$/.test(digest)) return json({ error: 'invalid digest' }, 400)
        await store.putDigest(deviceId, digest)
        return json({ ok: true })
      }
      return json({ error: 'method not allowed' }, 405)
    }

    if (parts.length === 2 && parts[0] === 'obsidian' && parts[1] === 'status') {
      if (!live.vault) return json({ error: 'no vault configured' }, 503)
      return json(await vaultStatus(live.vault))
    }

    if (parts.length === 2 && parts[0] === 'obsidian' && parts[1] === 'note') {
      if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405)
      const vault = live.vault
      if (!vault) return json({ error: 'no vault configured' }, 503)

      const body = await readJson(request)
      if (!body) return json({ error: 'invalid json body' }, 400)
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const filename = typeof body.filename === 'string' ? body.filename.trim() : ''
      const explicitPath = typeof body.path === 'string' ? body.path.trim() : ''
      const markdown = typeof body.markdown === 'string' ? body.markdown : ''

      if (!markdown) return json({ error: 'markdown is required' }, 400)
      if (filename && filename.includes('/')) {
        return json({ error: 'filename must not contain a path separator' }, 400)
      }

      // An explicit path means "this blip's own note", so it is written back to.
      // Otherwise the folder is applied here — the client never has to know where
      // notes live — and a title becomes a filename.
      const inFolder = (name: string) => (vault.folder ? `${vault.folder}/${name}` : name)
      const relativePath = explicitPath || inFolder(filename || noteFilename(title || 'Untitled'))

      if (!resolveNotePath(vault.vault, relativePath)) {
        return json({ error: 'note path escapes the vault, or is not a .md file' }, 400)
      }

      try {
        const result = await writeNote(vault.vault, relativePath, markdown, {
          replace: Boolean(explicitPath),
        })
        return json({ ok: true, path: result.path, created: result.created })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'write failed'
        return json({ error: message }, 502)
      }
    }

    if (parts.length === 1 && parts[0] === 'config') {
      const bridge = settingsBridge
      if (!bridge) return json({ error: 'settings are not available on this server' }, 503)

      // The settings screen is one screen, but two destinations: what describes the
      // server, and what describes the person signed in.
      const serverNow = async () => {
        if (!options.serverSettings) return {}
        return (await options.serverSettings.read()).config
      }
      // The server's own fields are read from the server, so the app sees one answer
      // rather than whatever the account happens to have stored.
      const withServer = (config: ServerConfig, runtime: Runtime, server: ServerConfig) => ({
        ...publicConfig(config, runtime),
        twaPackage: server.twaPackage ?? null,
        twaFingerprint: server.twaFingerprint ?? null,
        baseUrl: server.baseUrl ?? null,
        embedBaseUrl: server.embedBaseUrl ?? null,
        apiKeySet: Boolean(server.apiKey),
        embedApiKeySet: Boolean(server.embedApiKey),
      })

      if (request.method === 'GET') {
        const { config, runtime } = await bridge.read()
        return json({
          config: withServer(config, runtime, await serverNow()),
          providers: providerList(),
        })
      }

      if (request.method === 'PUT') {
        const body = await readJson(request)
        if (!body) return json({ error: 'invalid json body' }, 400)

        const { server, account } = splitPatch(configPatch(body))
        const problems = [...validateConfig(account), ...validateConfig(server)]
        if (problems.length > 0) {
          return json({ error: 'invalid settings', problems }, 400)
        }

        if (Object.keys(server).length > 0) {
          // Only an admin, when there are accounts at all. A server with none has one
          // person using it and nobody to be an admin *of* — and refusing them would mean
          // a single-user server could never set its own model.
          if (options.auth && user?.role !== 'admin') {
            return json({ error: 'only an admin can change the app settings' }, 403)
          }
          if (!options.serverSettings) {
            return json({ error: 'server settings are not available here' }, 503)
          }
          await options.serverSettings.update(server)
        }

        const { config, runtime } = await bridge.update(account)
        return json({
          config: withServer(config, runtime, await serverNow()),
          providers: providerList(),
        })
      }

      return json({ error: 'method not allowed' }, 405)
    }

    if (parts.length === 2 && parts[0] === 'llm' && request.method === 'POST') {
      const body = await readJson(request)
      if (!body) return json({ error: 'invalid json body' }, 400)

      if (parts[1] === 'complete') {
        const system = typeof body.system === 'string' ? body.system : ''
        const prompt = typeof body.prompt === 'string' ? body.prompt : ''
        if (!prompt.trim()) return json({ error: 'prompt is required' }, 400)
        if (!live.llm || !(await live.llm.available())) {
          return json({ error: 'no language model configured' }, 503)
        }
        try {
          return json({ text: await live.llm.completeStructured({ system, prompt }) })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'completion failed' }, 502)
        }
      }

      if (parts[1] === 'embed') {
        const texts = Array.isArray(body.texts)
          ? body.texts.filter((entry): entry is string => typeof entry === 'string').slice(0, 64)
          : []
        if (texts.length === 0) return json({ error: 'texts is required' }, 400)
        const embedder = live.embed ?? live.llm
        if (!embedder || !(await embedder.available())) {
          return json({ error: 'no embedding model configured' }, 503)
        }
        try {
          return json({ vectors: await embedder.embed(texts) })
        } catch (error) {
          return json({ error: error instanceof Error ? error.message : 'embedding failed' }, 502)
        }
      }

      return json({ error: 'not found' }, 404)
    }

    // Resolve a move's search phrases into links. The model supplies phrases, never
    // URLs, so a move can send someone somewhere real without inventing a link.
    //
    // A single `query` is still accepted: it was the shape before moves could carry more
    // than one, and a client that has not been reloaded yet should keep working.
    if (parts.length === 1 && parts[0] === 'lookup' && request.method === 'POST') {
      const body = await readJson(request)
      const queries = Array.isArray(body?.queries)
        ? body.queries.filter((query): query is string => typeof query === 'string')
        : typeof body?.query === 'string'
          ? [body.query]
          : []
      if (queries.length === 0) return json({ error: 'queries is required' }, 400)
      return json(await resolveLookUps(queries))
    }

    // A recording, turned into words. The browser sends what it captured and gets text back;
    // where the listening happens is the server's business, not the app's.
    if (parts.length === 1 && parts[0] === 'transcribe' && request.method === 'POST') {
      const transcriber = resolveTranscriber(liveConfig)
      if (!transcriber) {
        return json({ error: 'no transcriber is set up — set one in Admin' }, 503)
      }
      let audio: Blob | null = null
      try {
        const form = await request.formData()
        const file = form.get('audio')
        if (file instanceof Blob && file.size > 0) audio = file
      } catch {
        audio = null
      }
      if (!audio) return json({ error: 'the recording did not arrive' }, 400)
      try {
        const result = await transcribe(transcriber, audio)
        return json(result)
      } catch (error) {
        const message = error instanceof Error ? error.message : 'the transcriber failed'
        return json({ error: message }, 502)
      }
    }

    if (parts.length === 1 && parts[0] === 'fetch' && request.method === 'POST') {
      const body = await readJson(request)
      const url = body && typeof body.url === 'string' ? body.url : ''
      if (!url) return json({ error: 'url is required' }, 400)
      if (!isFetchableUrl(url)) return json({ error: 'url is not fetchable' }, 400)
      try {
        return json(await fetchPage(url))
      } catch (error) {
        return json({ error: error instanceof Error ? error.message : 'fetch failed' }, 502)
      }
    }

    if (parts.length === 2 && parts[0] === 'logs') {
      const deviceId = parts[1]
      if (!deviceId || !isSafeDeviceId(deviceId)) return json({ error: 'invalid device id' }, 400)

      if (request.method === 'GET') {
        const raw = url.searchParams.get('offset') ?? '0'
        const offset = Number(raw)
        if (!Number.isFinite(offset) || offset < 0) return json({ error: 'invalid offset' }, 400)
        const size = await store.logSize(deviceId)
        const bytes = offset >= size ? new Uint8Array(0) : await store.readLog(deviceId, offset)
        return new Response(toBody(bytes), {
          status: 200,
          headers: withCors(
            new Headers({
              'content-type': 'text/plain; charset=utf-8',
              'x-log-size': String(size),
            }),
          ),
        })
      }

      if (request.method === 'PUT') {
        const text = await request.text()
        let events: ReturnType<typeof parseLog>
        try {
          events = parseLog(text)
        } catch {
          return json({ error: 'malformed JSONL' }, 400)
        }
        // A device may only write its own log. This is what makes two writers
        // conflict-free rather than merely unlikely.
        if (events.some((event) => event.deviceId !== deviceId)) {
          return json({ error: 'event deviceId does not match the log being written' }, 400)
        }
        if (events.length === 0) {
          return json({ size: await store.logSize(deviceId), appended: 0 })
        }
        // Refuse a partial line rather than silently repairing it: a half-line
        // appended to a log would corrupt that device's history permanently.
        if (!text.endsWith('\n')) {
          return json({ error: 'payload must end at a line boundary' }, 400)
        }
        const size = await store.appendLog(deviceId, encoder.encode(text))
        return json({ size, appended: events.length })
      }

      return json({ error: 'method not allowed' }, 405)
    }

    if (parts.length === 2 && parts[0] === 'blobs') {
      const hash = parts[1]
      if (!hash || !isSafeHash(hash)) return json({ error: 'invalid hash' }, 400)

      if (request.method === 'HEAD') {
        const exists = await store.hasBlob(hash)
        return new Response(null, { status: exists ? 200 : 404, headers: withCors(new Headers()) })
      }

      if (request.method === 'GET') {
        const bytes = await store.getBlob(hash)
        if (!bytes) return json({ error: 'not found' }, 404)
        return new Response(toBody(bytes), {
          status: 200,
          headers: withCors(new Headers({ 'content-type': 'application/octet-stream' })),
        })
      }

      if (request.method === 'PUT') {
        const bytes = new Uint8Array(await request.arrayBuffer())
        if ((await sha256Hex(bytes)) !== hash) return json({ error: 'hash mismatch' }, 400)
        await store.putBlob(hash, bytes)
        return json({ ok: true, size: bytes.length })
      }

      return json({ error: 'method not allowed' }, 405)
    }

    return json({ error: 'not found' }, 404)
  }
}

/**
 * Friends, and the postbox between them.
 *
 * The server carries messages and does not interpret them: the recipient turns each into
 * an event in their own log, which is where it becomes real. So a message that arrives
 * twice is harmless, and a message that never arrives is a missing message rather than a
 * missing fact.
 *
 * Every route here needs a session, and every one of them is refused outright when the
 * person has turned social features off. There is no safe half of this to leave on: each
 * route either reads somebody else's attention or writes to it.
 */
async function handleSocial(
  path: string,
  request: Request,
  user: PublicUser,
  auth: Auth,
  social: SocialStore,
  storeSource: StoreSource,
  config: ServerConfig,
): Promise<Response> {
  if (config.socialEnabled === false) {
    return json({ error: 'social features are off for this account', socialOff: true }, 403)
  }

  const rest = path
    .slice('/social'.length)
    .split('/')
    .filter((part) => part.length > 0)

  const users = await auth.list()
  const usernames = new Map(users.map((entry) => [entry.id, entry.username]))
  const colors = new Map(users.map((entry) => [entry.id, defaultColor(entry.id)]))
  for (const user of users) if (user.color) colors.set(user.id, user.color)
  const avatars = new Map<string, string>()
  for (const user of users) if (user.avatar) avatars.set(user.id, user.avatar)
  const friendships = await social.friendships()
  const friendOf = (id: string) => users.find((entry) => entry.id === id)

  // --- who my friends are, and asking somebody to be one ------------------------------
  if (rest.length === 1 && rest[0] === 'friends') {
    if (request.method === 'GET') {
      return json({ friends: friendsOf(user.id, friendships, usernames, colors, avatars) })
    }

    if (request.method === 'POST') {
      const body = await readJson(request)
      const wanted = str(body, 'username').trim().toLowerCase()
      if (!wanted) return json({ error: 'a username is needed' }, 400)

      const target = users.find((entry) => entry.username.toLowerCase() === wanted)
      if (!target) return json({ error: 'no account with that username' }, 404)
      if (target.id === user.id) return json({ error: 'that is you' }, 400)
      if (areFriends(user.id, target.id, friendships)) {
        return json({ error: `you are already friends with ${target.username}` }, 400)
      }

      // Asked rather than assumed. Typing somebody's username must not be enough to be
      // shown what they have been noticing.
      await social.addFriendEvent({ t: 'requested', from: user.id, to: target.id })
      return json({
        friends: friendsOf(user.id, await social.friendships(), usernames, colors, avatars),
      })
    }

    return json({ error: 'method not allowed' }, 405)
  }

  // --- what a friend has chosen to share ------------------------------------------------
  if (rest.length === 3 && rest[0] === 'friends' && rest[2] === 'inklings') {
    const other = rest[1] ?? ''
    if (!areFriends(user.id, other, friendships)) {
      return json({ error: 'you are not friends' }, 403)
    }
    return json({
      inklings: await readSharedInklings(resolveStore(storeSource, other)),
    })
  }

  // --- a picture on something they have shared -------------------------------------------
  if (rest.length === 4 && rest[0] === 'friends' && rest[2] === 'blobs') {
    const other = rest[1] ?? ''
    const hash = rest[3] ?? ''
    if (!areFriends(user.id, other, friendships)) {
      return json({ error: 'you are not friends' }, 403)
    }
    if (!isSafeHash(hash)) return json({ error: 'invalid hash' }, 400)

    const allowed = await sharedMediaIds(resolveStore(storeSource, other))
    if (!allowed.has(hash)) {
      // Either it is private, or it was never theirs. Both answers are "no".
      return json({ error: 'that picture is not on an Inkling they have shared' }, 403)
    }

    const bytes = await resolveStore(storeSource, other).getBlob(hash)
    if (!bytes) return json({ error: 'not found' }, 404)
    return new Response(toBody(bytes), {
      status: 200,
      headers: withCors(new Headers({ 'content-type': 'application/octet-stream' })),
    })
  }

  // --- accepting, declining, removing --------------------------------------------------
  if (rest.length === 3 && rest[0] === 'friends') {
    const other = rest[1] ?? ''
    const action = rest[2] ?? ''
    const target = friendOf(other)
    if (!target) return json({ error: 'no such account' }, 404)

    if (request.method === 'POST' && (action === 'accept' || action === 'decline')) {
      const pending = friendships.find(
        (event) =>
          event.t === 'requested' &&
          event.from === other &&
          event.to === user.id &&
          event.at ===
            friendships
              .filter((e) => e.from === other && e.to === user.id)
              .sort((a, b) => (a.at < b.at ? 1 : -1))[0]?.at,
      )
      if (!pending) return json({ error: 'nothing to answer from them' }, 400)
      await social.addFriendEvent({
        t: action === 'accept' ? 'accepted' : 'declined',
        from: other,
        to: user.id,
      })
      return json({ friends: friendsOf(user.id, await social.friendships(), usernames) })
    }

    if (request.method === 'DELETE') {
      await social.addFriendEvent({ t: 'removed', from: user.id, to: other })
      return json({ friends: friendsOf(user.id, await social.friendships(), usernames) })
    }

    return json({ error: 'method not allowed' }, 405)
  }

  // --- the postbox ----------------------------------------------------------------------
  if (rest.length === 1 && rest[0] === 'inbox' && request.method === 'GET') {
    const url = new URL(request.url)
    const offset = Math.max(0, Number(url.searchParams.get('offset') ?? '0') || 0)
    const { messages, size } = await social.readInbox(user.id, offset)
    return json({
      messages,
      size,
      friends: friendsOf(user.id, friendships, usernames, colors, avatars),
    })
  }

  // --- asking a friend for a move --------------------------------------------------------
  if (rest.length === 1 && rest[0] === 'ask' && request.method === 'POST') {
    const body = await readJson(request)
    const to = str(body, 'to')
    const context = body?.context as AskContext | undefined
    if (!friendOf(to) || !areFriends(user.id, to, friendships)) {
      return json({ error: 'you are not friends' }, 403)
    }
    if (!context?.blipId || !context.title) return json({ error: 'the Inkling is missing' }, 400)

    // Checked here rather than only in the app, so that "private means private" is true
    // of what the server will pass on and not only of what a button will let you press.
    if (!(await ownsSharedBlip(resolveStore(storeSource, user.id), context.blipId))) {
      return json({ error: 'that Inkling is not shared with friends' }, 403)
    }

    const message: SocialMessage = {
      id: newId(),
      kind: 'ask',
      from: user.id,
      fromUsername: user.username,
      to,
      at: new Date().toISOString(),
      context: {
        blipId: context.blipId,
        type: context.type,
        title: context.title,
        body: context.body?.slice(0, 2000),
        topics: Array.isArray(context.topics) ? context.topics.slice(0, 12) : [],
        entries: Array.isArray(context.entries)
          ? context.entries.slice(0, ASK_ENTRIES_MAX).map((entry) => String(entry).slice(0, 600))
          : [],
        offered: Array.isArray(context.offered)
          ? context.offered.slice(0, ASK_ENTRIES_MAX).map((title) => String(title).slice(0, 200))
          : [],
        // Their own list is ignored: the ids come from the server's fold of the Inkling it has
        // just checked is shared. A sender that named a hash of its choosing would otherwise be
        // asking the recipient's app to fetch whatever it liked.
        mediaIds: await sharedMediaForBlip(resolveStore(storeSource, user.id), context.blipId),
      },
      note: str(body, 'note').trim().slice(0, NOTE_MAX) || undefined,
    }
    await social.send(message)
    return json({ message })
  }

  // --- suggesting a move for somebody else's Inkling --------------------------------------
  if (rest.length === 1 && rest[0] === 'move' && request.method === 'POST') {
    const body = await readJson(request)
    const to = str(body, 'to')
    if (!friendOf(to) || !areFriends(user.id, to, friendships)) {
      return json({ error: 'you are not friends' }, 403)
    }

    const move = sanitizeFriendMove(body?.move)
    if (!move) return json({ error: 'a move needs a title and a goal' }, 400)

    const message: SocialMessage = {
      id: newId(),
      kind: 'move',
      from: user.id,
      fromUsername: user.username,
      to,
      at: new Date().toISOString(),
      askId: str(body, 'askId').slice(0, 64),
      blipId: str(body, 'blipId').slice(0, 64),
      move,
      note: str(body, 'note').trim().slice(0, NOTE_MAX) || undefined,
    }
    await social.send(message)
    return json({ message })
  }

  // --- a note: encouragement, kudos, thanks ----------------------------------------------
  if (rest.length === 1 && rest[0] === 'note' && request.method === 'POST') {
    const body = await readJson(request)
    const to = str(body, 'to')
    const kind = body?.kind === 'kudos' ? 'kudos' : 'thanks'
    const text = str(body, 'text').trim().slice(0, NOTE_MAX)
    if (!friendOf(to) || !areFriends(user.id, to, friendships)) {
      return json({ error: 'you are not friends' }, 403)
    }
    if (!text) return json({ error: 'a note needs something in it' }, 400)

    const message: SocialMessage = {
      id: newId(),
      kind,
      from: user.id,
      fromUsername: user.username,
      to,
      at: new Date().toISOString(),
      blipId: str(body, 'blipId').slice(0, 64),
      ...(kind === 'kudos' ? { moveTitle: str(body, 'moveTitle').slice(0, 200) } : {}),
      text,
    } as SocialMessage
    await social.send(message)
    return json({ message })
  }

  return json({ error: 'not found' }, 404)
}
