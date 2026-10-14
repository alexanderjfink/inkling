import { createHandler } from './handler'
import { OpenRouterProvider, llmConfigFromEnv } from './llm'
import { FileStore } from './store'

const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.INKLING_DATA ?? new URL('../data/', import.meta.url).pathname

const store = new FileStore(dataDir)
const llm = new OpenRouterProvider(llmConfigFromEnv())
const server = Bun.serve({
  port,
  hostname: '0.0.0.0',
  fetch: createHandler(store, llm),
})

const model = llmConfigFromEnv()
console.log(`Inkling sync server listening on http://${server.hostname}:${server.port}`)
console.log(`  data directory: ${dataDir}`)
console.log(
  model.apiKey
    ? `  language model: ${model.model} via ${model.baseUrl}`
    : '  language model: none configured — set OPENROUTER_API_KEY to enable moves; the app falls back to its playbook',
)
console.log('  reach it from the phone over Tailscale, or via the PWA dev proxy at /api')
