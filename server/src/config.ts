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

export function configPath(dataDir: string): string {
  return join(dataDir, 'config.json')
}

export async function loadConfig(dataDir: string): Promise<ServerConfig> {
  try {
    const parsed = JSON.parse(await readFile(configPath(dataDir), 'utf8')) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as ServerConfig) : {}
  } catch {
    return {}
  }
}

export async function saveConfig(dataDir: string, config: ServerConfig): Promise<void> {
  const path = configPath(dataDir)
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
  const check = (field: string, value: unknown, label: string) => {
    if (value === undefined) return
    if (typeof value !== 'string' || value.trim().length === 0) {
      problems.push({ field, message: `${label} must not be empty` })
    }
  }

  check('provider', patch.provider, 'provider')
  check('model', patch.model, 'model')
  check('vault', patch.vault, 'vault')

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

  if (patch.provider !== undefined && !findPreset(patch.provider)) {
    problems.push({ field: 'provider', message: `unknown provider "${patch.provider}"` })
  }
  if (patch.embedProvider !== undefined && !findPreset(patch.embedProvider)) {
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
  if (
    patch.embedSimilarity !== undefined &&
    (typeof patch.embedSimilarity !== 'number' ||
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
      key === 'twaPackage' ||
      key === 'twaFingerprint' ||
      key === 'embedSimilarity'
    ) {
      Object.assign(next, { [key]: value })
    }
  }
  return next
}
