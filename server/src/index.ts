import {
  type Runtime,
  type ServerConfig,
  buildRuntime,
  loadConfig,
  mergeConfig,
  saveConfig,
} from './config'
import { createHandler } from './handler'
import { PRESETS } from './providerConfig'
import { FileStore } from './store'
import { vaultStatus } from './vault'

const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.INKLING_DATA ?? new URL('../data/', import.meta.url).pathname

const store = new FileStore(dataDir)

// Saved settings, plus the environment underneath them. The settings screen can
// change the model, the vault and the keys without a restart.
let config: ServerConfig = await loadConfig(dataDir)
let runtime: Runtime = buildRuntime(config)

const server = Bun.serve({
  port,
  hostname: '0.0.0.0',
  fetch: createHandler(store, {
    runtime: () => runtime,
    settings: {
      read: async () => ({ config, runtime }),
      update: async (patch) => {
        const merged = mergeConfig(config, patch)
        await saveConfig(dataDir, merged)
        config = merged
        runtime = buildRuntime(config)
        return { config, runtime, problems: [] }
      },
    },
  }),
})

function report() {
  console.log(`  data directory: ${dataDir}`)
  const { status } = runtime
  console.log(
    `  model: ${
      status.configured
        ? `${status.providerName ?? status.provider} · ${status.model}`
        : `${status.providerName ?? status.provider}: not configured`
    }`,
  )
  if (status.embeddings) {
    console.log(`  embeddings: ${status.embedProviderName ?? '?'} · ${status.embedModel}`)
  } else {
    console.log('  embeddings: none — related blips will use topics and links only')
  }
}

console.log(`Inkling sync server listening on http://${server.hostname}:${server.port}`)
report()
if (!runtime.status.configured) {
  console.log(
    `  presets: ${PRESETS.map((preset) => preset.id).join(', ')} — set one in the app's Settings`,
  )
  console.log('  the app works without a model; moves come from the playbook')
}

const vaultState = await vaultStatus(runtime.vault)
console.log(
  `  vault: ${vaultState.vault}${runtime.vault.folder ? ` (${runtime.vault.folder}/)` : ''}`,
)
if (!vaultState.exists) {
  console.log('  the vault directory does not exist yet; it will be created on the first note')
} else if (!vaultState.writable) {
  console.log('  the vault is not writable by this process — promotion will fail')
  console.log('    on macOS, ~/Documents needs Full Disk Access, or set the vault in Settings')
}

console.log('  everything above is editable in the app: Home → ⚙')
console.log('  reach it from the phone over Tailscale, or via the PWA dev proxy at /api')
