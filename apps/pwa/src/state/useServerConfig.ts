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
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(join(baseUrl, '/config'))
      if (res.status === 503) {
        setError('this server has no settings endpoint')
        return
      }
      if (!res.ok) throw new Error(`server said ${res.status}`)
      const body = (await res.json()) as { config: PublicConfig; providers?: ProviderOption[] }
      setConfig(body.config)
      setProviders(body.providers ?? [])
      setError(null)
    } catch (caught) {
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

  return { config, providers, error, saving, loaded, load, save }
}
