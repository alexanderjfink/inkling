import type { LLMProvider, StructuredRequest } from '@inkling/domain'
import type { KeySource, ResolvedProvider } from './providerConfig'

interface ChatResponse {
  choices?: Array<{ message?: { content?: string } }>
}
interface EmbeddingsResponse {
  data?: Array<{ embedding?: number[] }>
}
interface AnthropicResponse {
  content?: Array<{ type?: string; text?: string }>
}

const REQUEST_TIMEOUT_MS = 60_000

/**
 * The workhorse: every OpenAI-compatible endpoint.
 *
 * That covers OpenCode Go, OpenRouter, OpenAI, Google, Groq, and the local runners
 * (Ollama, vLLM, LM Studio, llama.cpp). The only quirk worth handling is
 * `response_format`, which several local servers reject — so we ask for JSON, and
 * quietly ask again without it rather than failing the move.
 */
/**
 * The models an endpoint says it can serve, with a failure that says why.
 *
 * "could not list models: 401" is the least useful version of that sentence. It does not
 * name the address, which is the thing most likely to be wrong and the thing someone just
 * typed in, and it throws away the response body, which usually says "invalid api key".
 * Both are in the message now, because this error is the whole diagnosis.
 */
async function listModelsFrom(
  url: string,
  headers: Record<string, string>,
  name: string,
): Promise<string[]> {
  let res: Response
  try {
    res = await fetch(url, { headers })
  } catch (error) {
    // A wrong address, a closed port, DNS and certificates all land here.
    throw new Error(
      `could not reach ${url}: ${error instanceof Error ? error.message : 'the request failed'}`,
    )
  }

  if (!res.ok) {
    const detail = (await res.text().catch(() => '')).trim().slice(0, 200)
    throw new Error(
      `${name} could not list models at ${url}: ${res.status}${detail ? ` — ${detail}` : ''}`,
    )
  }

  const body = (await res.json().catch(() => ({}))) as { data?: Array<{ id?: string }> }
  return (body.data ?? [])
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
    .sort((a, b) => a.localeCompare(b))
}

export class OpenAiCompatibleProvider implements LLMProvider {
  readonly name: string
  #baseUrl: string
  #apiKey: string | null
  #model: string
  #embedModel: string | null
  #sessionId: string | null

  constructor(resolved: ResolvedProvider) {
    this.name = resolved.preset.id
    this.#baseUrl = resolved.baseUrl
    this.#apiKey = resolved.apiKey
    this.#model = resolved.model
    this.#embedModel = resolved.embedModel
    this.#sessionId = resolved.sessionId
  }

  async available(): Promise<boolean> {
    return Boolean(this.#baseUrl && this.#model)
  }

  #headers(): Record<string, string> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      // Identify ourselves rather than arriving as a generic HTTP library.
      'user-agent': 'Inkling/0.1 (personal blip tool)',
    }
    if (this.#apiKey) headers.authorization = `Bearer ${this.#apiKey}`
    // Gateways such as OpenCode Go refuse requests without a session id.
    if (this.#sessionId) headers['x-opencode-session'] = this.#sessionId
    return headers
  }

  /** What this endpoint says it can serve. */
  async listModels(): Promise<string[]> {
    return listModelsFrom(`${this.#baseUrl}/models`, this.#headers(), this.name)
  }

  async #post(path: string, body: unknown): Promise<Response> {
    const headers = this.#headers()

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      return await fetch(`${this.#baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
  }

  async completeStructured(request: StructuredRequest): Promise<string> {
    const payload = {
      model: this.#model,
      temperature: 0.7,
      messages: [
        { role: 'system', content: request.system },
        { role: 'user', content: request.prompt },
      ],
    }

    let res = await this.#post('/chat/completions', {
      ...payload,
      response_format: { type: 'json_object' },
    })
    if (res.status === 400 || res.status === 422) {
      res = await this.#post('/chat/completions', payload)
    }
    if (!res.ok) throw new Error(`${this.name} failed: ${res.status}`)

    const body = (await res.json()) as ChatResponse
    const text = body.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error(`${this.name} returned no content`)
    }
    return text
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.#embedModel) {
      throw new Error(`${this.name} has no embedding model configured (set INKLING_EMBED_MODEL)`)
    }
    const res = await this.#post('/embeddings', { model: this.#embedModel, input: texts })
    if (!res.ok) throw new Error(`${this.name} embeddings failed: ${res.status}`)

    const body = (await res.json()) as EmbeddingsResponse
    return (body.data ?? []).map((entry) => entry.embedding ?? [])
  }
}

/** Anthropic's own shape, which is not OpenAI-compatible. */
export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic'
  #baseUrl: string
  #apiKey: string | null
  #model: string
  #sessionId: string | null

  constructor(resolved: ResolvedProvider) {
    this.#baseUrl = resolved.baseUrl
    this.#apiKey = resolved.apiKey
    this.#model = resolved.model
    this.#sessionId = resolved.sessionId
  }

  async available(): Promise<boolean> {
    return Boolean(this.#baseUrl && this.#model && this.#apiKey)
  }

  async completeStructured(request: StructuredRequest): Promise<string> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(`${this.#baseUrl}/messages`, {
        method: 'POST',
        headers: {
          'x-api-key': this.#apiKey ?? '',
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'user-agent': 'Inkling/0.1 (personal blip tool)',
          ...(this.#sessionId ? { 'x-opencode-session': this.#sessionId } : {}),
        },
        body: JSON.stringify({
          model: this.#model,
          max_tokens: 1024,
          system: request.system,
          messages: [{ role: 'user', content: request.prompt }],
        }),
        signal: controller.signal,
      })
    } finally {
      clearTimeout(timer)
    }
    if (!res.ok) throw new Error(`anthropic failed: ${res.status}`)

    const body = (await res.json()) as AnthropicResponse
    const text = body.content?.find((block) => block.type === 'text')?.text
    if (typeof text !== 'string' || text.trim().length === 0) {
      throw new Error('anthropic returned no content')
    }
    return text
  }

  async embed(_texts: string[]): Promise<number[][]> {
    throw new Error('anthropic has no embeddings API; related blips use topics and links instead')
  }

  async listModels(): Promise<string[]> {
    return listModelsFrom(
      `${this.#baseUrl}/models`,
      {
        'x-api-key': this.#apiKey ?? '',
        'anthropic-version': '2023-06-01',
        'user-agent': 'Inkling/0.1 (personal blip tool)',
      },
      'anthropic',
    )
  }
}

export function createProvider(resolved: ResolvedProvider): LLMProvider {
  return resolved.preset.kind === 'anthropic'
    ? new AnthropicProvider(resolved)
    : new OpenAiCompatibleProvider(resolved)
}

export interface ModelStatus {
  provider: string
  providerName: string
  model: string
  embedModel: string | null
  /** The provider serving embeddings, which may not be the one serving completions. */
  embedProvider: string | null
  embedProviderName: string | null
  configured: boolean
  keySource: KeySource
  /**
   * The address actually being called, after any override.
   *
   * Worth reporting because it is the thing that is wrong when a self-hosted model does
   * not answer, and it was previously invisible — the app showed the preset's name and
   * nothing about where the request went.
   */
  baseUrl: string
  embedBaseUrl: string | null
  /** Whether embeddings are available at all, from either provider. */
  embeddings: boolean
  /** Cosine floor above which two vectors count as similar. */
  embedSimilarity: number | null
  note?: string
}

export function modelStatus(
  resolved: ResolvedProvider,
  embed?: ResolvedProvider | null,
  embedSimilarity?: number | null,
): ModelStatus {
  const embedSource = embed ?? (resolved.embedModel ? resolved : null)
  return {
    provider: resolved.preset.id,
    providerName: resolved.preset.name,
    model: resolved.model,
    embedModel: embedSource?.embedModel ?? null,
    embedProvider: embedSource ? embedSource.preset.id : null,
    embedProviderName: embedSource ? embedSource.preset.name : null,
    configured: resolved.configured,
    keySource: resolved.keySource,
    baseUrl: resolved.baseUrl,
    embedBaseUrl: embedSource ? embedSource.baseUrl : null,
    embeddings: Boolean(embedSource?.embedModel),
    embedSimilarity: embedSimilarity ?? null,
    note: resolved.preset.note,
  }
}
