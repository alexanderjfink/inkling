import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/**
 * Which model to talk to, and where.
 *
 * Nearly every provider — OpenCode, OpenRouter, OpenAI, Google, Groq, and the local
 * runners (Ollama, vLLM, LM Studio) — speaks the same OpenAI-compatible shape. So
 * one transport covers almost everything, and a registry of presets is all that is
 * needed to make them selectable by name. Anthropic is the exception and gets its
 * own transport.
 */
export interface ProviderPreset {
  id: string
  name: string
  kind: 'openai-compatible' | 'anthropic'
  baseUrl: string
  /** Env vars checked in order for a key. */
  keyEnv: string[]
  /** Where OpenCode keeps the same credential, so keys need not be copied around. */
  opencodeAuthId?: string
  /** Local servers need no key at all. */
  keyOptional?: boolean
  /**
   * Gateways that route by conversation and require a stable session id header.
   * OpenCode Go rejects requests without it.
   */
  requiresSession?: boolean
  defaultModel: string
  defaultEmbedModel?: string
  /** True when the provider has no embeddings API. */
  noEmbeddings?: boolean
  note?: string
}

export const PRESETS: ProviderPreset[] = [
  {
    id: 'opencode-go',
    name: 'OpenCode Go',
    kind: 'openai-compatible',
    baseUrl: 'https://opencode.ai/inference/go/v1',
    keyEnv: ['OPENCODE_API_KEY'],
    opencodeAuthId: 'opencode-go',
    requiresSession: true,
    defaultModel: 'kimi-k2.6',
    note: 'Requires x-opencode-session, which is sent automatically. Only the models listed against /v1/chat/completions work here.',
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    kind: 'openai-compatible',
    baseUrl: 'https://opencode.ai/inference/v1',
    keyEnv: ['OPENCODE_API_KEY'],
    opencodeAuthId: 'opencode',
    requiresSession: true,
    defaultModel: 'gpt-5.4',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    kind: 'openai-compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    keyEnv: ['OPENROUTER_API_KEY'],
    defaultModel: 'anthropic/claude-haiku-4.5',
    defaultEmbedModel: 'openai/text-embedding-3-small',
  },
  {
    id: 'openai',
    name: 'OpenAI',
    kind: 'openai-compatible',
    baseUrl: 'https://api.openai.com/v1',
    keyEnv: ['OPENAI_API_KEY'],
    defaultModel: 'gpt-5.4',
    defaultEmbedModel: 'text-embedding-3-small',
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    kind: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    keyEnv: ['ANTHROPIC_API_KEY'],
    defaultModel: 'claude-haiku-4-5',
    noEmbeddings: true,
    note: 'No embeddings API, so related blips fall back to topics and links.',
  },
  {
    id: 'google',
    name: 'Google',
    kind: 'openai-compatible',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    keyEnv: ['GEMINI_API_KEY', 'GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY'],
    defaultModel: 'gemini-flash-latest',
    defaultEmbedModel: 'text-embedding-004',
  },
  {
    id: 'groq',
    name: 'Groq',
    kind: 'openai-compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    keyEnv: ['GROQ_API_KEY'],
    defaultModel: 'llama-3.3-70b-versatile',
  },
  {
    id: 'ollama',
    name: 'Ollama (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:11434/v1',
    keyEnv: ['OLLAMA_API_KEY'],
    keyOptional: true,
    defaultModel: 'llama3.2',
    defaultEmbedModel: 'nomic-embed-text',
    note: 'Start it with OLLAMA_HOST=0.0.0.0 if the server is not on the same machine.',
  },
  {
    id: 'vllm',
    name: 'vLLM (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:8000/v1',
    keyEnv: ['VLLM_API_KEY'],
    keyOptional: true,
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
    note: 'Any OpenAI-compatible server works; vLLM, TGI and llama.cpp all fit here.',
  },
  {
    id: 'lmstudio',
    name: 'LM Studio (local)',
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:1234/v1',
    keyEnv: [],
    keyOptional: true,
    defaultModel: 'local-model',
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-compatible endpoint',
    kind: 'openai-compatible',
    baseUrl: '',
    keyEnv: [],
    keyOptional: true,
    defaultModel: '',
    note: 'Set INKLING_BASE_URL and INKLING_MODEL.',
  },
]

export function findPreset(id: string): ProviderPreset | undefined {
  return PRESETS.find((preset) => preset.id === id)
}

export type KeySource = 'env' | 'opencode-auth' | 'none' | 'not-needed'

/** Read a credential out of OpenCode's own auth store, so keys are not duplicated. */
export function readOpencodeAuth(
  providerId: string,
  authPath = join(homedir(), '.local/share/opencode/auth.json'),
): string | null {
  try {
    const parsed = JSON.parse(readFileSync(authPath, 'utf8')) as Record<
      string,
      { type?: string; key?: string } | undefined
    >
    const entry = parsed[providerId]
    // Only plain API keys. An OAuth access token needs different headers and would
    // fail confusingly if passed as a key.
    return entry?.type === 'api' && entry.key ? entry.key : null
  } catch {
    return null
  }
}

export interface ResolvedProvider {
  preset: ProviderPreset
  baseUrl: string
  apiKey: string | null
  model: string
  embedModel: string | null
  configured: boolean
  keySource: KeySource
  /** Sent as x-opencode-session when the preset requires one. */
  sessionId: string | null
}

export interface ResolveOptions {
  /** Overrides for tests, or for reading someone else's store. */
  authPath?: string
}

export function resolveProvider(
  env: Record<string, string | undefined> = process.env,
  options: ResolveOptions = {},
): ResolvedProvider {
  const requestedId = env.INKLING_PROVIDER?.trim() || 'opencode-go'
  const preset = findPreset(requestedId) ?? findPreset('custom')
  if (!preset) throw new Error('no provider presets defined')

  const baseUrl = (env.INKLING_BASE_URL?.trim() || preset.baseUrl).replace(/\/+$/, '')

  let apiKey: string | null = null
  let keySource: KeySource = 'none'

  const explicit = env.INKLING_API_KEY?.trim()
  if (explicit) {
    apiKey = explicit
    keySource = 'env'
  } else {
    for (const name of preset.keyEnv) {
      const value = env[name]?.trim()
      if (value) {
        apiKey = value
        keySource = 'env'
        break
      }
    }
  }

  if (!apiKey && preset.opencodeAuthId) {
    const stored = readOpencodeAuth(preset.opencodeAuthId, options.authPath)
    if (stored) {
      apiKey = stored
      keySource = 'opencode-auth'
    }
  }

  if (!apiKey && preset.keyOptional) keySource = 'not-needed'

  const model = env.INKLING_MODEL?.trim() || preset.defaultModel
  const embedModel = preset.noEmbeddings
    ? null
    : env.INKLING_EMBED_MODEL?.trim() || preset.defaultEmbedModel || null

  return {
    preset,
    baseUrl,
    apiKey,
    model,
    embedModel,
    configured:
      Boolean(baseUrl) && Boolean(model) && (apiKey !== null || Boolean(preset.keyOptional)),
    keySource,
    // A stable id per server process. Gateways use it for routing and prompt
    // caching, so it should not change on every request.
    sessionId: preset.requiresSession ? env.INKLING_SESSION?.trim() || crypto.randomUUID() : null,
  }
}

export function describeProvider(resolved: ResolvedProvider): string {
  if (!resolved.configured) {
    return `${resolved.preset.name}: not configured (${missingReason(resolved)})`
  }
  const key = resolved.keySource === 'opencode-auth' ? 'key from OpenCode' : 'key from env'
  return `${resolved.preset.name} · ${resolved.model} · ${key}`
}

function missingReason(resolved: ResolvedProvider): string {
  if (!resolved.baseUrl) return 'set INKLING_BASE_URL'
  if (!resolved.model) return 'set INKLING_MODEL'
  return `set ${resolved.preset.keyEnv[0] ?? 'an API key'}`
}
