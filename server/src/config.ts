import type { LLMProvider } from '@inkling/domain'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { type ModelStatus, createProvider, modelStatus } from './provider'
import {
  embedSimilarityFromEnv,
  findPreset,
  resolveEmbedProvider,
  resolveProvider,
} from './providerConfig'
import { type VaultConfig, vaultConfigFromEnv } from './vault'

/**
 * Configuration that can be changed from the app rather than from a shell.
 *
 * Precedence is: saved settings, then the environment. The environment still
 * supplies anything the settings do not mention, and secrets are only ever written
 * here — never read back out over HTTP.
 */
export interface ServerConfig {
  provider?: string
  model?: string
  embedProvider?: string
  embedModel?: string
  embedSimilarity?: number | null
  /**
   * Where the model actually is, when it is not where the preset says.
   *
   * The presets cover the common case, but a local runner is often not local — Ollama
   * on another box, vLLM on the LAN, a gateway behind a domain. Without this there was
   * no way to say so from the app: the value was read from `INKLING_BASE_URL` and
   * nothing could set it, so the "custom endpoint" preset had no endpoint to give it.
   */
  baseUrl?: string
  embedBaseUrl?: string
  vault?: string
  folder?: string
  /**
   * For a Trusted Web Activity APK. The package name and the SHA-256 signing
   * fingerprint, which together let Android drop the URL bar and run the app
   * full-screen instead of as a browser tab.
   */
  twaPackage?: string
  twaFingerprint?: string
  /** Accepted on write; never returned. */
  apiKey?: string
  embedApiKey?: string
}

export interface Runtime {
  llm?: LLMProvider
  embed?: LLMProvider
  status: ModelStatus
  vault: VaultConfig
}

/**
 * Where a config lives.
 *
 * Two kinds, and they are different files on purpose. A person's config is
 * `config.json`; the server's own is `server.json`. Keeping the server's out of
 * `config.json` is what lets "adopt whatever was here before accounts" be a plain
 * move — the server writes its file back after adopting, and if that file were
 * `config.json` the *second* account would adopt it.
 */
export function configPath(dataDir: string, file = 'config.json'): string {
  return join(dataDir, file)
}

export async function loadConfig(dataDir: string, file = 'config.json'): Promise<ServerConfig> {
  try {
    const parsed = JSON.parse(await readFile(configPath(dataDir, file), 'utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as ServerConfig) : {}
  } catch {
    return {}
  }
}

export async function saveConfig(
  dataDir: string,
  config: ServerConfig,
  file = 'config.json',
): Promise<void> {
  const path = configPath(dataDir, file)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function overlay(config: ServerConfig, env: Record<string, string | undefined>) {
  return {
    ...env,
    ...(config.provider ? { INKLING_PROVIDER: config.provider } : {}),
    ...(config.model ? { INKLING_MODEL: config.model } : {}),
    ...(config.apiKey ? { INKLING_API_KEY: config.apiKey } : {}),
    ...(config.embedProvider ? { INKLING_EMBED_PROVIDER: config.embedProvider } : {}),
    ...(config.embedModel ? { INKLING_EMBED_MODEL: config.embedModel } : {}),
    ...(config.embedApiKey ? { INKLING_EMBED_API_KEY: config.embedApiKey } : {}),
    ...(config.baseUrl ? { INKLING_BASE_URL: config.baseUrl } : {}),
    ...(config.embedBaseUrl ? { INKLING_EMBED_BASE_URL: config.embedBaseUrl } : {}),
    ...(typeof config.embedSimilarity === 'number'
      ? { INKLING_EMBED_SIMILARITY: String(config.embedSimilarity) }
      : {}),
    ...(config.vault ? { INKLING_VAULT: config.vault } : {}),
    ...(config.folder !== undefined ? { INKLING_VAULT_FOLDER: config.folder } : {}),
  }
}

/** Build the live model and vault from saved settings plus the environment. */
export function buildRuntime(
  config: ServerConfig,
  env: Record<string, string | undefined> = process.env,
): Runtime {
  const effective = overlay(config, env)
  const resolved = resolveProvider(effective)
  const embedResolved = resolveEmbedProvider(effective)

  return {
    llm: resolved.configured ? createProvider(resolved) : undefined,
    embed: embedResolved ? createProvider(embedResolved) : undefined,
    status: modelStatus(resolved, embedResolved, embedSimilarityFromEnv(effective)),
    vault: vaultConfigFromEnv(effective),
  }
}

/** What a client may see. Keys are reported as set or not set, never returned. */
export function publicConfig(config: ServerConfig, runtime: Runtime) {
  return {
    provider: runtime.status.provider,
    providerName: runtime.status.providerName,
    model: runtime.status.model,
    embedProvider: runtime.status.embedProvider,
    embedProviderName: runtime.status.embedProviderName,
    embedModel: runtime.status.embedModel,
    embedSimilarity: runtime.status.embedSimilarity,
    embeddings: runtime.status.embeddings,
    configured: runtime.status.configured,
    vault: runtime.vault.vault,
    folder: runtime.vault.folder,
    baseUrl: config.baseUrl ?? null,
    embedBaseUrl: config.embedBaseUrl ?? null,
    twaPackage: config.twaPackage ?? null,
    twaFingerprint: config.twaFingerprint ?? null,
    apiKeySet: Boolean(config.apiKey),
    embedApiKeySet: Boolean(config.embedApiKey),
  }
}

/** A SHA-256 fingerprint as Android prints it: 32 colon-separated hex pairs. */
const FINGERPRINT = /^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/

/**
 * The Digital Asset Links document a TWA needs, or null when it is not configured.
 *
 * Without this, Android shows the URL bar and the APK is a browser tab in a costume.
 * With it, the site and the app are declared to be the same thing.
 */
export function assetLinks(config: ServerConfig): unknown[] | null {
  const pkg = config.twaPackage?.trim()
  const fingerprint = config.twaFingerprint?.trim().toUpperCase()
  if (!pkg || !fingerprint) return null
  return [
    {
      relation: ['delegate_permission/common.handle_all_urls'],
      target: {
        namespace: 'android_app',
        package_name: pkg,
        sha256_cert_fingerprints: [fingerprint],
      },
    },
  ]
}

export interface ConfigProblem {
  field: string
  message: string
}

/** Validate an incoming patch, so a typo cannot silently break the server. */
export function validateConfig(patch: ServerConfig): ConfigProblem[] {
  const problems: ConfigProblem[] = []
  /**
   * An empty value is not a mistake.
   *
   * It is how mergeConfig reads "go back to the default", and the settings form sends one
   * whenever a field is left blank — so refusing it did not just make clearing
   * impossible, it made a blank *unrelated* field fail the whole save. That is what was
   * happening here: the model never got its API key because the similarity floor beside
   * it was empty, and the refusal arrived as "must be between 0 and 1".
   */
  const check = (field: string, value: unknown, label: string) => {
    if (value === undefined || value === '') return
    if (typeof value !== 'string') problems.push({ field, message: `${label} must be text` })
  }

  check('provider', patch.provider, 'provider')
  check('model', patch.model, 'model')
  check('vault', patch.vault, 'vault')

  // A base URL is checked only when it holds something: an empty string is how you go
  // back to the preset's own address, and mergeConfig reads it that way.
  for (const [field, value, label] of [
    ['baseUrl', patch.baseUrl, 'model server address'],
    ['embedBaseUrl', patch.embedBaseUrl, 'embedding server address'],
  ] as const) {
    if (value === undefined || value.trim().length === 0) continue
    let parsed: URL | null = null
    try {
      parsed = new URL(value.trim())
    } catch {
      parsed = null
    }
    if (!parsed || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
      problems.push({ field, message: `${label} must be an http:// or https:// address` })
    }
  }

  // The two TWA fields are checked only when they hold something: an empty string is
  // how you clear them, and mergeConfig reads it that way. Sending "" to remove a
  // package name should not be an error about a package name being empty.
  if (patch.twaPackage !== undefined && patch.twaPackage.trim().length > 0) {
    const value = patch.twaPackage.trim()
    // Android package names are reverse-DNS-ish and must contain at least two segments.
    if (!/^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/.test(value)) {
      problems.push({
        field: 'twaPackage',
        message: 'must be a package name like app.inkling.mobile',
      })
    }
  }
  if (patch.twaFingerprint !== undefined && patch.twaFingerprint.trim().length > 0) {
    if (!FINGERPRINT.test(patch.twaFingerprint.trim())) {
      problems.push({
        field: 'twaFingerprint',
        message: 'must be a SHA-256 fingerprint like AA:BB:… (32 colon-separated hex pairs)',
      })
    }
  }

  // "— server default —" is the first option in the picker and sends an empty string,
  // which is not an unknown provider; it is the absence of one.
  if (patch.provider && !findPreset(patch.provider)) {
    problems.push({ field: 'provider', message: `unknown provider "${patch.provider}"` })
  }
  if (patch.embedProvider && !findPreset(patch.embedProvider)) {
    problems.push({ field: 'embedProvider', message: `unknown provider "${patch.embedProvider}"` })
  }
  if (patch.embedProvider) {
    const preset = findPreset(patch.embedProvider)
    if (preset?.noEmbeddings) {
      problems.push({
        field: 'embedProvider',
        message: `${preset.name} has no embeddings API`,
      })
    }
  }
  // Null clears it, which is what an empty box sends — so it is a value, not an error.
  if (
    patch.embedSimilarity !== undefined &&
    patch.embedSimilarity !== null &&
    (typeof patch.embedSimilarity !== 'number' ||
      !Number.isFinite(patch.embedSimilarity) ||
      patch.embedSimilarity <= 0 ||
      patch.embedSimilarity >= 1)
  ) {
    problems.push({ field: 'embedSimilarity', message: 'must be between 0 and 1' })
  }

  return problems
}

/** Merge a patch over the stored config. An empty string clears a field. */
export function mergeConfig(current: ServerConfig, patch: ServerConfig): ServerConfig {
  const next: ServerConfig = { ...current }
  for (const key of Object.keys(patch) as Array<keyof ServerConfig>) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === '' || value === null) {
      delete next[key]
      continue
    }
    // Only the known fields are ever written.
    if (
      key === 'provider' ||
      key === 'model' ||
      key === 'embedProvider' ||
      key === 'embedModel' ||
      key === 'vault' ||
      key === 'folder' ||
      key === 'apiKey' ||
      key === 'embedApiKey' ||
      key === 'baseUrl' ||
      key === 'embedBaseUrl' ||
      key === 'twaPackage' ||
      key === 'twaFingerprint' ||
      key === 'embedSimilarity'
    ) {
      Object.assign(next, { [key]: value })
    }
  }
  return next
}
