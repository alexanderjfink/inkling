import { createHandler } from './handler'
import { createProvider, modelStatus } from './provider'
import {
  PRESETS,
  describeEmbedProvider,
  describeProvider,
  embedSimilarityFromEnv,
  resolveEmbedProvider,
  resolveProvider,
} from './providerConfig'
import { FileStore } from './store'
import { vaultConfigFromEnv, vaultStatus } from './vault'

const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.INKLING_DATA ?? new URL('../data/', import.meta.url).pathname

const resolved = resolveProvider()
const embedResolved = resolveEmbedProvider()
const vault = vaultConfigFromEnv()
const store = new FileStore(dataDir)

const server = Bun.serve({
  port,
  hostname: '0.0.0.0',
  fetch: createHandler(store, {
    llm: createProvider(resolved),
    embed: embedResolved ? createProvider(embedResolved) : undefined,
    model: modelStatus(resolved, embedResolved, embedSimilarityFromEnv()),
    vault,
  }),
})

console.log(`Inkling sync server listening on http://${server.hostname}:${server.port}`)
console.log(`  data directory: ${dataDir}`)
console.log(`  model: ${describeProvider(resolved)}`)
if (!resolved.configured) {
  console.log(
    `  presets: ${PRESETS.map((preset) => preset.id).join(', ')} — pick one with INKLING_PROVIDER`,
  )
  console.log('  the app works without a model; moves come from the playbook')
}

const status = modelStatus(resolved, embedResolved)
if (embedResolved) {
  console.log(`  embeddings: ${describeEmbedProvider(embedResolved)}`)
} else if (!status.embeddings) {
  console.log('  embeddings: none — related blips will use topics and links only')
  console.log('    set INKLING_EMBED_PROVIDER (e.g. omlx, ollama) to turn semantic relatedness on')
}

const vaultState = await vaultStatus(vault)
console.log(`  vault: ${vaultState.vault}${vault.folder ? ` (${vault.folder}/)` : ''}`)
if (!vaultState.exists) {
  console.log('  the vault directory does not exist yet; it will be created on the first note')
} else if (!vaultState.writable) {
  console.log('  the vault is not writable by this process — promotion will fail')
  console.log('    on macOS, ~/Documents needs Full Disk Access, or set INKLING_VAULT elsewhere')
}

console.log('  reach it from the phone over Tailscale, or via the PWA dev proxy at /api')
