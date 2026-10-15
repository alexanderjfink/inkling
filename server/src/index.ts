import { existsSync } from 'node:fs'
import { createAccountManager } from './accounts'
import { Auth } from './auth'
import { buildRuntime } from './config'
import { createHandler } from './handler'
import { PRESETS } from './providerConfig'
import { vaultStatus } from './vault'

const port = Number(process.env.PORT ?? 8787)
const dataDir = process.env.INKLING_DATA ?? new URL('../data/', import.meta.url).pathname

// The built app, so one origin serves both the app and the API. This is what makes
// `/api` correct away from the dev server.
const staticDir = new URL('../../apps/pwa/dist/', import.meta.url).pathname
const servingApp = existsSync(new URL('../../apps/pwa/dist/index.html', import.meta.url).pathname)

const auth = new Auth(dataDir)
const accounts = await createAccountManager(dataDir)

// Docker-friendly: create the first account without clicking through setup, for a
// server whose volume is already provisioned.
if (await auth.needsSetup()) {
  const username = process.env.INKLING_ADMIN_USER?.trim()
  const password = process.env.INKLING_ADMIN_PASSWORD
  if (username && password) {
    const created = await auth.setup(username, password)
    console.log(
      created.ok
        ? `  created the first account from the environment: ${username}`
        : `  could not create the first account: ${created.error}`,
    )
  }
}

const server = Bun.serve({
  port,
  hostname: '0.0.0.0',
  fetch: createHandler(accounts.storeFor, {
    staticDir: servingApp ? staticDir : undefined,
    auth,
    accountFor: accounts.accountFor,
    serverSettings: accounts.serverSettings,
  }),
})

console.log(`Inkling sync server listening on http://${server.hostname}:${server.port}`)
console.log(`  data directory: ${dataDir}`)
console.log(
  (await auth.needsSetup())
    ? '  accounts: none yet — the first account you create becomes the admin'
    : `  accounts: ${await auth.count()}`,
)
console.log(
  servingApp
    ? `  app: serving the built app from this same origin — open http://localhost:${server.port}`
    : '  app: not built — run `bun run build` to serve it from this origin, or use `bun run dev`',
)
console.log(
  `  presets: ${PRESETS.map((preset) => preset.id).join(', ')} — set one in the app's Settings`,
)
console.log('  the app works without a model; moves come from the playbook')

const adopted = accounts.adopted()
if (adopted.length > 0) {
  console.log(`  adopted the existing data into: ${adopted.join(', ')}`)
}

// Report a vault at start, so a broken path is visible now rather than at the first
// promotion. Each account has its own, so this shows the first one.
const users = await auth.list()
const first = users[0]
const vault = first ? (await accounts.accountFor(first)).runtime.vault : buildRuntime({}).vault
const vaultState = await vaultStatus(vault)
console.log(
  `  vault: ${vaultState.vault}${vault.folder ? ` (${vault.folder}/)` : ''}${
    users.length > 1 ? ` — and one per account, ${users.length} in total` : ''
  }`,
)
if (!vaultState.exists) {
  console.log('  the vault directory does not exist yet; it will be created on the first note')
} else if (!vaultState.writable) {
  console.log('  the vault is not writable by this process — promotion will fail')
  console.log('    on macOS, ~/Documents needs Full Disk Access, or set the vault in Settings')
}

console.log('  everything above is editable in the app: Home → ⚙')
console.log('  on the phone, use `tailscale serve` or `adb reverse` for a secure context')
