import { access, mkdir, readdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { PublicUser } from '@inkling/domain'
import {
  type Runtime,
  type ServerConfig,
  buildRuntime,
  configPath,
  loadConfig,
  mergeConfig,
  saveConfig,
} from './config'
import type { AccountContext, SettingsBridge } from './handler'
import { FileStore } from './store'

/**
 * One directory per account, and one settings screen that writes to two places.
 *
 * `users/<id>/` holds everything that belongs to a person: their logs, their blobs,
 * their model settings, their vault. The server's own `config.json` holds only what
 * describes the server — the TWA package name and fingerprint, which belong to one APK
 * pointing at one server and would be wrong per person.
 */

async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** The server's own config. Not `config.json`, which belongs to a person. */
const SERVER_FILE = 'server.json'

export interface AccountManager {
  storeFor: (userId: string) => FileStore
  accountFor: (user: PublicUser) => Promise<AccountContext>
  /** Server-wide settings. Only the TWA fields mean anything here. */
  serverSettings: SettingsBridge
  serverConfig: () => ServerConfig
  /** Directories that have been adopted from the pre-accounts layout. */
  adopted: () => string[]
}

export async function createAccountManager(dataDir: string): Promise<AccountManager> {
  const userDir = (userId: string) => join(dataDir, 'users', userId)

  /**
   * Lift the server's own settings out of the pre-accounts config, at startup.
   *
   * Before accounts there was one config holding both kinds of setting. This cannot wait
   * for the lazy adoption that happens on the first signed-in request, because the
   * Android verifier fetches the asset links document with no session at all — so
   * anything depending on adoption would 404 until somebody happened to sign in.
   */
  async function liftServerFields(): Promise<ServerConfig> {
    const server = await loadConfig(dataDir, SERVER_FILE)
    if (!(await exists(configPath(dataDir)))) return server

    const legacy = await loadConfig(dataDir)
    if (legacy.twaPackage === undefined && legacy.twaFingerprint === undefined) return server

    if (!server.twaPackage && legacy.twaPackage) server.twaPackage = legacy.twaPackage
    if (!server.twaFingerprint && legacy.twaFingerprint)
      server.twaFingerprint = legacy.twaFingerprint

    delete legacy.twaPackage
    delete legacy.twaFingerprint
    await saveConfig(dataDir, legacy)
    await saveConfig(dataDir, server, SERVER_FILE)
    return server
  }

  /**
   * Move the model settings from the first account that has them onto the server.
   *
   * The model used to be per account, so an existing server has a key sitting in somebody's
   * `config.json`. Moving it means nobody has to find and re-paste a key because of a
   * change they did not ask for. Only from an account that has one, only when the server
   * has none, and only once: after this the server owns the fields and the account's copy
   * is deleted, so a later account cannot quietly re-adopt them.
   *
   * Deliberately at startup rather than lazily, for the same reason as the fields above —
   * the model has to be there before the first request, not after somebody signs in.
   */
  async function liftModelFields(server: ServerConfig): Promise<ServerConfig> {
    if (server.provider || server.apiKey) return server

    const MODEL_FIELDS = [
      'provider',
      'model',
      'embedProvider',
      'embedModel',
      'embedSimilarity',
      'baseUrl',
      'embedBaseUrl',
      'apiKey',
      'embedApiKey',
    ] as const

    /** Take the model fields off one config and give them to the server. */
    async function take(path: string, from: string): Promise<boolean> {
      const config = await loadConfig(path)
      // Any of them, not just a provider or a key: a config holding only a model is still
      // a config somebody set up, and leaving it behind is exactly the outcome this exists
      // to avoid.
      if (!MODEL_FIELDS.some((field) => config[field] !== undefined)) return false

      for (const field of MODEL_FIELDS) {
        if (config[field] !== undefined) Object.assign(server, { [field]: config[field] })
      }
      for (const field of MODEL_FIELDS) delete config[field]
      await saveConfig(path, config)
      await saveConfig(dataDir, server, SERVER_FILE)
      console.log(`  moved the model settings from ${from} onto the server`)
      return true
    }

    // The pre-accounts config first: on a server that predates accounts, this is where the
    // model actually is, and it is read here rather than left for the lazy adoption below —
    // which happens on the first signed-in request, long after the model is needed.
    if (await exists(configPath(dataDir))) {
      if (await take(dataDir, 'the pre-accounts config')) return server
    }

    try {
      const dir = join(dataDir, 'users')
      for (const entry of (await readdir(dir)).sort()) {
        if (await take(join(dir, entry), entry)) return server
      }
    } catch {
      // No users directory yet, which is simply a server nobody has signed into.
    }
    return server
  }

  let serverConfig: ServerConfig = await liftModelFields(await liftServerFields())
  const adopted: string[] = []

  const serverSettings: SettingsBridge = {
    read: async () => ({ config: serverConfig, runtime: buildRuntime(serverConfig) }),
    update: async (patch) => {
      serverConfig = mergeConfig(serverConfig, patch)
      await saveConfig(dataDir, serverConfig, SERVER_FILE)
      // Every account's runtime holds a copy of this, so they all have to be rebuilt —
      // otherwise a new model would take effect for whoever saved it and nobody else.
      //
      // Mutated rather than replaced: the settings bridge handed out earlier holds this
      // exact object, so putting a new one in the map leaves that bridge writing to an
      // orphan — which showed up as a saved setting that read back correctly once and then
      // reverted on the next request.
      for (const state of accounts.values()) {
        state.runtime = runtimeFor(state.config)
      }
      return { config: serverConfig, runtime: buildRuntime(serverConfig), problems: [] }
    },
  }

  /**
   * Move whatever was here before accounts existed into this account's directory.
   *
   * A *move*, not a copy, which is what makes it safely one-time: the next account to
   * sign in finds nothing left to adopt. Nothing is deleted, and if the move fails the
   * old layout is untouched and still readable.
   *
   * There is deliberately no guard beyond "is it there". An earlier version keyed on the
   * logs directory existing, which stranded a config that had no logs — and a person who
   * set up their model before capturing anything is a perfectly ordinary person.
   */
  async function adoptLegacyData(dir: string): Promise<void> {
    let moved = false
    for (const name of ['logs', 'blobs', 'digests', 'config.json']) {
      const from = join(dataDir, name)
      if (await exists(from)) {
        await rename(from, join(dir, name))
        moved = true
      }
    }
    if (moved) adopted.push(dir)
  }

  const accounts = new Map<string, { config: ServerConfig; runtime: Runtime }>()

  /**
   * One model for the server, one vault per person.
   *
   * The model settings are read from the server's config on every build, so a change made
   * on the admin screen takes effect for everybody at once rather than being copied into
   * each account and drifting.
   */
  function runtimeFor(config: ServerConfig): Runtime {
    return buildRuntime({
      ...serverConfig,
      // The vault is the one thing here that belongs to a person: a note goes into their
      // folder, not everybody's.
      vault: config.vault,
      folder: config.folder,
    })
  }

  async function accountFor(user: PublicUser): Promise<AccountContext> {
    let state = accounts.get(user.id)
    if (!state) {
      const dir = userDir(user.id)
      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true })
        await adoptLegacyData(dir)
      }
      const config = await loadConfig(dir)
      state = { config, runtime: runtimeFor(config) }
      accounts.set(user.id, state)
    }

    const current = state
    return {
      runtime: current.runtime,
      settings: {
        read: async () => ({ config: current.config, runtime: current.runtime }),
        update: async (patch) => {
          const merged = mergeConfig(current.config, patch)
          await saveConfig(userDir(user.id), merged)
          current.config = merged
          current.runtime = runtimeFor(merged)
          return { config: merged, runtime: current.runtime, problems: [] }
        },
      },
    }
  }

  return {
    storeFor: (userId) => new FileStore(userDir(userId)),
    accountFor,
    serverSettings,
    serverConfig: () => serverConfig,
    adopted: () => [...adopted],
  }
}
