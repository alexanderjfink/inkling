import type { LLMProvider, StructuredRequest } from '@inkling/domain'

/**
 * The server holds the API key so devices never do.
 *
 * Everything here is optional: with no key configured the server still runs, the
 * proxy endpoints answer 503, and the app falls back to the handcrafted playbook.
 * That is the intended shape — the model is an enhancement, never a dependency.
 */
export interface LlmConfig {
  apiKey: string | null
  model: string
  embedModel: string
  baseUrl: string
}

export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig {
  const apiKey = env.OPENROUTER_API_KEY?.trim()
  return {
    apiKey: apiKey && apiKey.length > 0 ? apiKey : null,
    model: env.INKLING_MODEL?.trim() || 'anthropic/claude-3.5-haiku',
    embedModel: env.INKLING_EMBED_MODEL?.trim() || 'openai/text-embedding-3-small',
    baseUrl: (env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1').replace(
      /\/+$/,
      '',
    ),
  }
}

export class OpenRouterProvider implements LLMProvider {
  readonly name = 'openrouter'
  #config: LlmConfig

  constructor(config: LlmConfig) {
    this.#config = config
  }

  async available(): Promise<boolean> {
    return this.#config.apiKey !== null
  }

  #key(): string {
    const key = this.#config.apiKey
    if (!key) throw new Error('no OpenRouter API key configured')
    return key
  }

  async completeStructured(request: StructuredRequest): Promise<string> {
    const res = await fetch(`${this.#config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#key()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.#config.model,
        temperature: 0.7,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.prompt },
        ],
      }),
    })
    if (!res.ok) throw new Error(`openrouter failed: ${res.status}`)

    const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
    const text = body.choices?.[0]?.message?.content
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('openrouter returned no content')
    }
    return text
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${this.#config.baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#key()}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ model: this.#config.embedModel, input: texts }),
    })
    if (!res.ok) throw new Error(`openrouter embeddings failed: ${res.status}`)

    const body = (await res.json()) as { data?: Array<{ embedding?: number[] }> }
    return (body.data ?? []).map((entry) => entry.embedding ?? [])
  }
}
