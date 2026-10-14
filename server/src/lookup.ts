export interface LookupResult {
  title: string
  url: string
  description: string | null
  extract: string
  source: 'wikipedia'
}

const SEARCH_ENDPOINT = 'https://en.wikipedia.org/w/rest.php/v1/search/page'
const MAX_QUERY = 200
const MIN_EXTRACT = 40

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Find a real page about something.
 *
 * The model is never asked for a URL — it supplies a search phrase, and the link
 * comes from here. A hallucinated URL is worse than no link, because it looks like
 * an answer; a search phrase cannot be wrong in the same way.
 *
 * Wikipedia because it needs no key, has a stable API, and is genuinely the right
 * source for a lot of what gets captured. Returns null rather than throwing: a move
 * without material is still a perfectly good move.
 */
export async function lookupTopic(
  query: string,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<LookupResult | null> {
  const trimmed = query.trim().slice(0, MAX_QUERY)
  if (trimmed.length < 2) return null

  const fetcher = options.fetcher ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)

  try {
    const res = await fetcher(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(trimmed)}&limit=1`, {
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'user-agent': 'Inkling/0.1 (personal blip tool)',
      },
    })
    if (!res.ok) return null

    const body = (await res.json()) as {
      pages?: Array<{ key?: string; title?: string; description?: string; excerpt?: string }>
    }
    const page = body.pages?.[0]
    if (!page?.key || !page.title) return null

    const extract = stripHtml(page.excerpt ?? '').slice(0, 600)
    // A one-line stub is not worth putting in front of someone.
    if (extract.length < MIN_EXTRACT) return null

    return {
      title: page.title,
      url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.key)}`,
      description: page.description?.trim() || null,
      extract,
      source: 'wikipedia',
    }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
