#!/usr/bin/env bun
/**
 * A development stack you can drive, and keep.
 *
 * Why this exists: the slow part of working on Inkling was never the commands — biome is
 * 0.2s, three typechecks are 2s, 566 tests are 6s, a build is 2s. It was the *round trips*:
 * start a server, wait a fixed ten seconds, sign in, skip a walkthrough, rebuild the app so
 * the server can serve it, reload, sign in again. Ten-odd steps before seeing a change, and
 * every one of them a step an agent has to take with a large page snapshot attached.
 *
 * So: one command, a stack that hot-reloads, and a data directory that survives. The account
 * it creates is only made once — after that the session token in the browser keeps working
 * across reloads and restarts, so there is no signing in twice. The Inklings you capture
 * while poking at something are still there next time, which is usually what you want when
 * you are checking that the thing you just changed behaves.
 *
 *   bun run probe                 the defaults below
 *   bun run probe -- --fresh      throw the data away and start over
 */
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const args = process.argv.slice(2)
const fresh = args.includes('--fresh')

const API_PORT = Number(process.env.PROBE_API_PORT ?? 8787)
const APP_PORT = Number(process.env.PROBE_APP_PORT ?? 5173)
const dataDir = process.env.PROBE_DATA ?? join(root, '.probe')
const username = process.env.PROBE_USER ?? 'probe'
const password = process.env.PROBE_PASSWORD ?? 'a good passphrase'

const api = `http://localhost:${API_PORT}`
const app = `https://localhost:${APP_PORT}`
const log = join(dataDir, 'probe.log')

if (fresh) await rm(dataDir, { recursive: true, force: true })
await mkdir(dataDir, { recursive: true })

/** Whatever was left on the ports from last time. Silent if there was nothing. */
function freePort(port: number): void {
  const found = Bun.spawnSync(['lsof', '-ti', `:${port}`])
  const pids = new TextDecoder()
    .decode(found.stdout)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  for (const pid of pids) {
    if (Number(pid) !== process.pid) Bun.spawnSync(['kill', pid])
  }
}
freePort(API_PORT)
freePort(APP_PORT)

const output = Bun.file(log).writer()
const children: Array<ReturnType<typeof spawn>> = []

function start(command: string[], env: Record<string, string>): void {
  const child = spawn(command[0] as string, command.slice(1), {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => void output.write(chunk))
  }
  children.push(child)
}

start(['bun', 'run', '--filter', '@inkling/server', 'dev'], { INKLING_DATA: dataDir })
start(['bun', 'run', '--filter', '@inkling/pwa', 'dev'], {})

/** Ask until it answers, rather than sleeping a number somebody guessed at. */
async function waitFor(check: () => Promise<boolean>, what: string): Promise<void> {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    if (await check().catch(() => false)) return
    await Bun.sleep(200)
  }
  console.error(`\n  ${what} did not come up in 45s. Log: ${log}\n`)
  shutdown(1)
}

async function up(url: string, secure = false): Promise<boolean> {
  const res = secure
    ? await fetch(url, { tls: { rejectUnauthorized: false } } as RequestInit)
    : await fetch(url)
  return res.ok
}

function shutdown(code: number): never {
  for (const child of children) child.kill()
  void output.end()
  process.exit(code)
}

await waitFor(() => up(`${api}/api/health`), 'the server')
await waitFor(() => up(`${app}/`, true), 'the app')

// The account is made once. After that the token in the browser is still good, which is the
// whole point of keeping the directory.
const state = (await fetch(`${api}/api/auth/state`).then((res) => res.json())) as {
  needsSetup?: boolean
}
const created = Boolean(state.needsSetup)

if (created) {
  await fetch(`${api}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password }),
  })
}

await writeFile(
  join(dataDir, 'README.txt'),
  `Throwaway data for driving the app by hand. Not the real thing, never the real thing.\n`,
)

console.log(`
  Inkling, ready to poke at

    app      ${app}          open this one
    api      ${api} (served under the same /api from the app)
    data     ${dataDir}
    log      ${log}

  ${created ? `an account was made: ${username} / ${password}` : `sign in as ${username} / ${password} (made last time)`}

  After a change: save the file and reload the page. No build, and no signing in again —
  the session lives in the browser and the data lives in ${dataDir}.
`)

process.on('SIGINT', () => shutDown(0))
process.on('SIGTERM', () => shutDown(0))
await new Promise(() => {})
