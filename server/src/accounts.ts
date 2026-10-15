import { access, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'
import type { PublicUser } from '@inkling/domain'
import {
  type Runtime,
  type ServerConfig,
  buildRuntime,
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

  let serverConfig: ServerConfig = await loadConfig(dataDir)
  const adopted: string[] = []

  const serverSettings: SettingsBridge = {
    read: async () => ({ config: serverConfig, runtime: buildRuntime(serverConfig) }),
    update: async (patch) => {
      serverConfig = mergeConfig(serverConfig, patch)
      await saveConfig(dataDir, serverConfig)
      return { config: serverConfig, runtime: buildRuntime(serverConfig), problems: [] }
    },
  }

  /**
   * Move whatever was here before accounts existed into this account's directory.
   *
   * A *move*, not a copy, which is what makes it safely one-time: the next account to
   * sign in finds nothing left to adopt. Nothing is deleted, and if the move fails the
   * old layout is untouched and still readable.
   */
  async function adoptLegacyData(dir: string): Promise<void> {
    // The pre-accounts layout is identified by its logs directory. Without one there is
    // nothing to adopt — and that guard is load-bearing: adopting writes the server's
    // own config back to disk, so without it the *second* account would adopt the
    // server's TWA settings and the first would lose them.
    if (!(await exists(join(dataDir, 'logs')))) return

    for (const name of ['logs', 'blobs', 'digests']) {
      const from = join(dataDir, name)
      if (await exists(from)) await rename(from, join(dir, name))
    }

    const legacyConfig = join(dataDir, 'config.json')
    if (await exists(legacyConfig)) {
      await rename(legacyConfig, join(dir, 'config.json'))
      // The TWA fields were in that file too, and they are not the person's. Put them
      // back, or the server forgets its own settings the moment accounts arrive.
      const server: ServerConfig = {}
      if (serverConfig.twaPackage) server.twaPackage = serverConfig.twaPackage
      if (serverConfig.twaFingerprint) server.twaFingerprint = serverConfig.twaFingerprint
      await saveConfig(dataDir, server)
    }

    adopted.push(dir)
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
