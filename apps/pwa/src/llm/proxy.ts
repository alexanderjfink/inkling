import type { LLMProvider, StructuredRequest } from '@inkling/domain'

function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

export interface ModelHealth {
  configured: boolean
  provider: string | null
  providerName: string | null
  model: string | null
  embedModel: string | null
  /** Whether the server's provider can produce embeddings at all. */
  embeddings: boolean
  keySource: string | null
  note: string | null
}

const UNKNOWN: ModelHealth = {
  configured: false,
  provider: null,
  providerName: null,
  model: null,
  embedModel: null,
  embeddings: false,
  keySource: null,
  note: null,
}

/**
 * The client's view of the model: the server's proxy.
 *
 * The API key lives on the server, so this is the only way the app can reach a
 * model. `health()` is a real check rather than an assumption — a server with no
 * provider configured answers honestly, and every caller falls back accordingly.
 */
export class ProxyProvider implements LLMProvider {
  readonly name = 'server-proxy'
  #baseUrl: string
  #health: ModelHealth | null = null

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl
  }

  async health(): Promise<ModelHealth> {
    // Only a configured answer is cached. A negative one is often transient — the
    // server restarting, a brief network blip — and caching it would disable the
    // model for the rest of the session for no good reason.
    if (this.#health?.configured) return this.#health
    try {
      const res = await fetch(join(this.#baseUrl, '/llm/health'))
      if (!res.ok) return UNKNOWN
      const body = (await res.json()) as Partial<ModelHealth>
      const health: ModelHealth = { ...UNKNOWN, ...body }
      if (health.configured) this.#health = health
      return health
    } catch {
      return UNKNOWN
    }
  }

  async available(): Promise<boolean> {
    return (await this.health()).configured
  }

  async completeStructured(request: StructuredRequest): Promise<string> {
    const res = await fetch(join(this.#baseUrl, '/llm/complete'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    if (!res.ok) throw new Error(`completion failed: ${res.status}`)
    const body = (await res.json()) as { text?: string }
    if (typeof body.text !== 'string') throw new Error('completion returned no text')
    return body.text
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(join(this.#baseUrl, '/llm/embed'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ texts }),
    })
    if (!res.ok) throw new Error(`embedding failed: ${res.status}`)
    const body = (await res.json()) as { vectors?: number[][] }
    return body.vectors ?? []
  }
}

export interface FetchedPage {
  url: string
  title: string
  excerpt: string
}

/** Fetch a page's title and excerpt through the server, avoiding browser CORS. */
export async function fetchPageVia(baseUrl: string, url: string): Promise<FetchedPage | null> {
  try {
    const res = await fetch(join(baseUrl, '/fetch'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
    })
    if (!res.ok) return null
    return (await res.json()) as FetchedPage
  } catch {
    return null
  }
}
