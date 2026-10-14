import { createHandler } from './handler'
import { createProvider, modelStatus } from './provider'
import { PRESETS, describeProvider, resolveProvider } from './providerConfig'
import { FileStore } from './store'

const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.INKLING_DATA ?? new URL('../data/', import.meta.url).pathname

const resolved = resolveProvider()
const store = new FileStore(dataDir)
const server = Bun.serve({
  port,
  hostname: '0.0.0.0',
  fetch: createHandler(store, createProvider(resolved), modelStatus(resolved)),
})

console.log(`Inkling sync server listening on http://${server.hostname}:${server.port}`)
console.log(`  data directory: ${dataDir}`)
console.log(`  model: ${describeProvider(resolved)}`)
if (!resolved.configured) {
  console.log(
    `  presets: ${PRESETS.map((preset) => preset.id).join(', ')} — pick one with INKLING_PROVIDER`,
  )
  console.log('  the app works without a model; moves come from the playbook')
} else if (!resolved.embedModel) {
  console.log('  embeddings: none — related blips will use topics and links only')
}
console.log('  reach it from the phone over Tailscale, or via the PWA dev proxy at /api')
