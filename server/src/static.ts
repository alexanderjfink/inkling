import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve, sep } from 'node:path'

/**
 * Serve the built PWA from the sync server.
 *
 * This is what makes the app work away from the dev server. With the app and the
 * API on one origin, `/api` is simply correct — no proxy, no CORS, no mixed
 * content, and nothing to type into Settings. The phone just points at the server.
 */

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

async function readIfFile(path: string): Promise<Uint8Array | null> {
  try {
    const info = await stat(path)
    if (!info.isFile()) return null
    return new Uint8Array(await readFile(path))
  } catch {
    return null
  }
}

function respond(bytes: Uint8Array, path: string): Response {
  const type = TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream'
  // Hashed assets can be cached hard; the shell and the worker must not be, or an
  // update would never arrive.
  const immutable = path.includes(`${sep}assets${sep}`)
  const name = path.split(sep).pop() ?? ''
  const cache = immutable ? 'public, max-age=31536000, immutable' : 'no-cache'

  return new Response(bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      'content-type': type,
      'cache-control': cache,
      ...(name === 'sw.js' ? { 'service-worker-allowed': '/' } : {}),
    },
  })
}

export async function serveStatic(dir: string, pathname: string): Promise<Response | null> {
  const root = resolve(dir)
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const candidate = resolve(root, normalize(relative))

  // Never serve outside the build directory.
  if (candidate !== root && !candidate.startsWith(root + sep)) return null

  const file = await readIfFile(candidate)
  if (file) return respond(file, candidate)

  // Client-side routing: an unknown path with no extension gets the shell.
  if (!extname(pathname)) {
    const index = await readIfFile(join(root, 'index.html'))
    if (index) return respond(index, 'index.html')
  }

  return null
}

/** Shown at / when the app has not been built yet. */
export function notBuiltPage(): Response {
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Inkling</title>
<style>
  body { font: 16px/1.6 ui-sans-serif, system-ui, sans-serif; max-width: 34rem;
         margin: 4rem auto; padding: 0 1.5rem; color: #17171b; background: #f1f1f4; }
  code { background: #fff; padding: .15rem .4rem; border-radius: .35rem; }
  h1 { font-size: 1.4rem; }
  li { margin: .4rem 0; }
</style>
<h1>Inkling server is running</h1>
<p>The API is live at <code>/api</code>, but the app itself has not been built, so
there is nothing to serve here yet.</p>
<ul>
  <li><b>To develop:</b> <code>bun run dev</code> — starts this server and the app
      together on port 5173.</li>
  <li><b>To use it for real:</b> <code>bun run build</code>, then reload this page.
      The app and the API then share this one origin.</li>
</ul>
`,
    {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' },
    },
  )
}
