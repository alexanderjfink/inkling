import { access, mkdir, rename } from 'node:fs/promises'
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

  let serverConfig: ServerConfig = await liftServerFields()
  const adopted: string[] = []

  const serverSettings: SettingsBridge = {
    read: async () => ({ config: serverConfig, runtime: buildRuntime(serverConfig) }),
    update: async (patch) => {
      serverConfig = mergeConfig(serverConfig, patch)
      await saveConfig(dataDir, serverConfig, SERVER_FILE)
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

  async function accountFor(user: PublicUser): Promise<AccountContext> {
    let state = accounts.get(user.id)
    if (!state) {
      const dir = userDir(user.id)
      if (!(await exists(dir))) {
        await mkdir(dir, { recursive: true })
        await adoptLegacyData(dir)
      }
      const config = await loadConfig(dir)
      state = { config, runtime: buildRuntime(config) }
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
          current.runtime = buildRuntime(merged)
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
