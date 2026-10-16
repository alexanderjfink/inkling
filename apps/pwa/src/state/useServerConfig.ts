import type { ShareDefault } from '@inkling/domain'
import { useCallback, useEffect, useState } from 'react'
import { apiFetch } from '../api'
import { needsServerUrl } from '../native'

export interface PublicConfig {
  provider: string | null
  providerName: string | null
  model: string | null
  embedProvider: string | null
  embedProviderName: string | null
  embedModel: string | null
  embedSimilarity: number | null
  embeddings: boolean
  configured: boolean
  vault: string
  folder: string
  baseUrl: string | null
  embedBaseUrl: string | null
  twaPackage: string | null
  twaFingerprint: string | null
  apiKeySet: boolean
  embedApiKeySet: boolean
  /** On unless this account has turned it off. */
  socialEnabled: boolean
  /** Whether new Inklings start shared with friends. */
  shareDefault: ShareDefault
  /** Where speech is transcribed, when the server has been given somewhere. */
  transcribeProvider: string | null
  transcribeModel: string | null
  transcribeBaseUrl: string | null
  transcribeApiKeySet: boolean
}

export interface ProviderOption {
  id: string
  name: string
  kind: string
  keyEnv: string[]
  /** The preset's own address, shown as the placeholder. */
  baseUrl: string
  defaultModel: string
  keyOptional: boolean
  noEmbeddings: boolean
  note: string | null
}

/**
 * A settings change.
 *
 * Booleans are allowed as well as strings and numbers: the social toggle is a boolean, and
 * sending it as "false" would be a string that `mergeConfig` would happily store and that
 * nothing would ever compare equal to `false`.
 */
export type ConfigPatch = Record<string, string | number | boolean | null>

function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type ServerStatus = 'loading' | 'ok' | 'no-endpoint' | 'unreachable' | 'signed-out'

export interface ServerDiagnosis {
  status: ServerStatus
  /** A plain-language reason, and what to do about it. */
  detail: string | null
  /** Candidate URLs to offer, given where this page is being served from. */
  suggestions: Array<{ url: string; label: string }>
}

/**
 * Work out why the server might not be reachable, and what to put instead.
 *
 * The default `/api` is only correct when the app and the API share an origin. That
 * is true when the server serves the built app, and when the dev server proxies it —
 * but not otherwise, and a bare "could not connect" leaves you guessing.
 */
export function diagnoseServer(serverUrl: string, status: ServerStatus): ServerDiagnosis {
  const https = window.location.protocol === 'https:'
  const host = window.location.hostname
  const suggestions: Array<{ url: string; label: string }> = []

  // In the native shell the app is served from the device, so a relative path points
  // at the device. That fails looking exactly like "the server is down", so name it.
  if (needsServerUrl(serverUrl)) {
    return {
      status,
      detail:
        'This is the Android app, which is served from the phone itself — so the server has to be a full address, like https://your-machine.ts.net/api. Set it above.',
      suggestions,
    }
  }

  if (!https) {
    suggestions.push({ url: `http://${host}:8787`, label: `the server on ${host}:8787` })
  }
  suggestions.push({ url: '/api', label: "this app's own origin (/api)" })
  if (https) {
    suggestions.push({ url: `https://${host}:8787`, label: `the server on ${host} over https` })
  }

  if (status === 'ok') {
    return { status, detail: null, suggestions }
  }
  if (status === 'loading') {
    return { status, detail: 'checking…', suggestions }
  }
  if (status === 'signed-out') {
    return { status, detail: 'Sign in to load the settings from this server.', suggestions }
  }
  if (status === 'no-endpoint') {
    return {
      status,
      detail:
        'Reached something, but it has no settings endpoint — that is an older Inkling server. Restart it with `bun run dev`.',
      suggestions,
    }
  }

  // Unreachable. The most common cause is worth naming outright.
  if (https && serverUrl.startsWith('http://')) {
    return {
      status,
      detail:
        'An https page cannot call an http address. Use the dev proxy (/api), or give the server a real certificate with `tailscale serve`.',
      suggestions,
    }
  }

  return {
    status,
    detail:
      'Could not reach the server. Start it with `bun run dev` — that runs the server and the app together — or point at it directly below.',
    suggestions,
  }
}

/**
 * Reading and writing the server's configuration from the app.
 *
 * Keys are only ever written: the server reports whether one is set, never what it
 * is, so nothing secret round-trips through the browser.
 */
export function useServerConfig(baseUrl: string, accountId: string | null = null) {
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ServerStatus>('loading')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await apiFetch(join(baseUrl, '/config'))
      if (res.status === 401) {
        // Not signed in yet. That is not a broken server, and saying so would send
        // someone off to check an address that is perfectly fine.
        setStatus('signed-out')
        setError(null)
        return
      }
      if (res.status === 503) {
        setStatus('no-endpoint')
        setError('this server has no settings endpoint')
        return
      }
      if (!res.ok) throw new Error(`server said ${res.status}`)
      const body = (await res.json()) as { config: PublicConfig; providers?: ProviderOption[] }
      setConfig(body.config)
      setProviders(body.providers ?? [])
      setStatus('ok')
      setError(null)
    } catch (caught) {
      setStatus('unreachable')
      setError(message(caught))
    } finally {
      setLoaded(true)
    }
    // Reloads when the account changes: the settings belong to whoever is signed in.
  }, [baseUrl, accountId])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (patch: ConfigPatch): Promise<boolean> => {
      setSaving(true)
      try {
        const res = await apiFetch(join(baseUrl, '/config'), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
        const body = (await res.json().catch(() => ({}))) as {
          config?: PublicConfig
          providers?: ProviderOption[]
          error?: string
          problems?: Array<{ field: string; message: string }>
        }
        if (!res.ok) {
          setError(
            body.problems?.map((problem) => problem.message).join('; ') ??
              body.error ??
              `server said ${res.status}`,
          )
          return false
        }
        if (body.config) setConfig(body.config)
        if (body.providers) setProviders(body.providers)
        setError(null)
        return true
      } catch (caught) {
        setError(message(caught))
        return false
      } finally {
        setSaving(false)
      }
    },
    [baseUrl],
  )

  return { config, providers, error, saving, loaded, load, save, status }
}

export interface TestResult {
  ok: boolean
  ms?: number
  detail?: string
  error?: string
}

export interface ModelsResult {
  ok: boolean
  models?: string[]
  error?: string
}

/**
 * One real round trip to the model, and the list of what it says it can serve.
 *
 * Both are the difference between "saved" and "actually works" — a key can be
 * present and still wrong, and the model name can be a typo.
 */
export function useModelTools(baseUrl: string) {
  const [testing, setTesting] = useState<'chat' | 'embed' | null>(null)
  const [listing, setListing] = useState<'chat' | 'embed' | null>(null)

  const testConnection = useCallback(
    async (kind: 'chat' | 'embed' = 'chat'): Promise<TestResult> => {
      setTesting(kind)
      try {
        const res = await apiFetch(join(baseUrl, '/llm/test'), {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ kind }),
        })
        return (await res.json()) as TestResult
      } catch (caught) {
        return { ok: false, error: message(caught) }
      } finally {
        setTesting(null)
      }
    },
    [baseUrl],
  )

  const loadModels = useCallback(
    async (kind: 'chat' | 'embed' = 'chat'): Promise<ModelsResult> => {
      setListing(kind)
      try {
        const res = await apiFetch(join(baseUrl, `/llm/models?kind=${kind}`))
        const body = (await res.json().catch(() => ({}))) as {
          models?: string[]
          error?: string
        }
        if (!res.ok) return { ok: false, error: body.error ?? `server said ${res.status}` }
        return { ok: true, models: body.models ?? [] }
      } catch (caught) {
        return { ok: false, error: message(caught) }
      } finally {
        setListing(null)
      }
    },
    [baseUrl],
  )

  return { testConnection, loadModels, testing, listing }
}
