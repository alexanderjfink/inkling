import { type LLMProvider, type MoveLink, searchUrl, type StructuredRequest } from '@inkling/domain'
import { apiFetch } from '../api'

function join(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`
}

export interface ModelHealth {
  configured: boolean
  provider: string | null
  providerName: string | null
  model: string | null
  embedModel: string | null
  embedProvider: string | null
  embedProviderName: string | null
  /** Whether the server can produce embeddings at all. */
  embeddings: boolean
  /** Cosine floor for "similar in meaning"; model-dependent. */
  embedSimilarity: number | null
  keySource: string | null
  /** Where the request actually goes, after any override in Settings. */
  baseUrl: string | null
  embedBaseUrl: string | null
  /** Which build the server is running, to compare against this app's own. */
  build: string | null
  note: string | null
}

const UNKNOWN: ModelHealth = {
  configured: false,
  provider: null,
  providerName: null,
  model: null,
  embedModel: null,
  embedProvider: null,
  embedProviderName: null,
  embeddings: false,
  embedSimilarity: null,
  keySource: null,
  baseUrl: null,
  embedBaseUrl: null,
  build: null,
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
      const res = await apiFetch(join(this.#baseUrl, '/llm/health'))
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

  /** Drop the cached health, so a settings change is picked up immediately. */
  forget(): void {
    this.#health = null
  }

  async completeStructured(request: StructuredRequest): Promise<string> {
    const res = await apiFetch(join(this.#baseUrl, '/llm/complete'), {
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
    const res = await apiFetch(join(this.#baseUrl, '/llm/embed'), {
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

export interface LookupResult {
  title: string
  url: string
  description: string | null
  extract: string
  source: string
}

export interface LookedUp {
  links: MoveLink[]
  /** The first real page found, which is the thing worth reading. */
  material: LookupResult | null
}

/**
 * Turn a move's phrases into links.
 *
 * The model supplies phrases, never URLs — a hallucinated link looks like an answer,
 * whereas a phrase that is wrong simply finds nothing.
 *
 * When the server cannot be reached, every phrase becomes a search link rather than the
 * move losing its links entirely. The phrase is still the model's, so it is still not a
 * URL anybody invented; it is just a search box instead of a page.
 */
export async function lookupVia(baseUrl: string, queries: string[]): Promise<LookedUp> {
  const wanted = queries.map((query) => query.trim()).filter((query) => query.length > 0)
  const searched: LookedUp = {
    links: wanted.map((query) => ({ label: query, url: searchUrl(query), kind: 'search' })),
    material: null,
  }
  if (wanted.length === 0) return { links: [], material: null }

  try {
    const res = await apiFetch(join(baseUrl, '/lookup'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ queries: wanted }),
    })
    if (!res.ok) return searched
    const body = (await res.json()) as Partial<LookedUp>
    const links = Array.isArray(body.links) ? body.links : []
    return { links: links.length > 0 ? links : searched.links, material: body.material ?? null }
  } catch {
    return searched
  }
}

/** Fetch a page's title and excerpt through the server, avoiding browser CORS. */
export async function fetchPageVia(baseUrl: string, url: string): Promise<FetchedPage | null> {
  try {
    const res = await apiFetch(join(baseUrl, '/fetch'), {
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
