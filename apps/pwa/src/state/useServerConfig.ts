import { useCallback, useEffect, useState } from 'react'

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
  apiKeySet: boolean
  embedApiKeySet: boolean
}

export interface ProviderOption {
  id: string
  name: string
  kind: string
  keyEnv: string[]
  defaultModel: string
  keyOptional: boolean
  noEmbeddings: boolean
  note: string | null
}

export type ConfigPatch = Record<string, string | number | null>

function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export type ServerStatus = 'loading' | 'ok' | 'no-endpoint' | 'unreachable'

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
export function useServerConfig(baseUrl: string) {
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<ServerStatus>('loading')
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const res = await fetch(join(baseUrl, '/config'))
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
  }, [baseUrl])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(
    async (patch: ConfigPatch): Promise<boolean> => {
      setSaving(true)
      try {
        const res = await fetch(join(baseUrl, '/config'), {
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
