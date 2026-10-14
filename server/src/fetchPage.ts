export interface FetchedPage {
  url: string
  title: string
  excerpt: string
}

const MAX_EXCERPT = 1200

/**
 * Hosts the server must not fetch on a user's behalf. Without this, a captured
 * "URL" could be used to probe the machine the server runs on or anything else on
 * its private network.
 */
const PRIVATE_HOST =
  /^(localhost|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\]|::1$)/i

export function isFetchableUrl(raw: string): boolean {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return !PRIVATE_HOST.test(url.hostname)
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
}

function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Fetch a page and reduce it to a title and a readable excerpt.
 *
 * Deliberately crude — no readability dependency. The goal is only to give a
 * resurfacing blip something concrete to react to instead of a bare link.
 */
export async function fetchPage(
  rawUrl: string,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<FetchedPage> {
  if (!isFetchableUrl(rawUrl)) throw new Error('url is not fetchable')

  const fetcher = options.fetcher ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  try {
    const res = await fetcher(rawUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Inkling/0.1 (personal blip tool)' },
    })
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`)

    const html = await res.text()
    const title = stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').slice(0, 200)
    const excerpt = stripHtml(html).slice(0, MAX_EXCERPT)
    return { url: rawUrl, title, excerpt }
  } finally {
    clearTimeout(timer)
  }
}
