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
/** Ask for several, so one bad top hit does not have to be the answer. */
const CANDIDATES = 5

/**
 * Words that say nothing about what a page is about.
 *
 * The model writes search phrases like "Ursidice Supernormal who made it", so the
 * question words have to go before anything is compared — otherwise a page that happens
 * to contain "made" looks like a match.
 */
const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'about',
  'over',
  'under',
  'who',
  'what',
  'why',
  'how',
  'when',
  'where',
  'which',
  'whose',
  'there',
  'their',
  'they',
  'them',
  'then',
  'than',
  'some',
  'any',
  'all',
  'not',
  'but',
  'you',
  'your',
  'its',
  'his',
  'her',
  'our',
  'out',
  'off',
  'one',
  'two',
  'was',
  'were',
  'are',
  'did',
  'does',
  'done',
  'have',
  'has',
  'had',
  'been',
  'being',
  'made',
  'make',
  'made',
  'get',
  'got',
  'can',
  'could',
  'should',
  'would',
  'will',
  'just',
  'like',
  'more',
  'most',
  'much',
  'very',
  'also',
  'already',
  'still',
  'even',
  'only',
  'other',
  'same',
  'such',
  'tried',
  'try',
  'tries',
  'missed',
  'miss',
  'about',
  'look',
  'looks',
  'used',
  'use',
])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
}

/** The words in a query that could actually identify a page. */
export function queryTerms(query: string): string[] {
  return [...new Set(words(query).filter((word) => word.length >= 3 && !STOPWORDS.has(word)))]
}

/** Suffixes that turn one word into another form of itself. */
const SUFFIXES = ['s', 'es', 'ed', 'ing']

/**
 * The same word, or one a suffix away from it — "algorithm" and "algorithms".
 *
 * Suffixes rather than a bare prefix, because a bare prefix makes "social" match
 * "socialist" and "socialism", which is how a filter like this stops filtering.
 */
function alike(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length < 4 || !long.startsWith(short)) return false
  return SUFFIXES.includes(long.slice(short.length))
}

/**
 * The words Wikipedia actually matched, taken from the highlight markup it puts around
 * them in the excerpt.
 *
 * This is the useful signal, and it is Wikipedia's own rather than a guess: the excerpt
 * for "stages of change" on *Transtheoretical model* marks `stages` and `change`, even
 * though neither word is in the title or the description.
 */
function markedWords(html: string): string[] {
  const out: string[] = []
  for (const match of html.matchAll(/<span class="searchmatch">(.*?)<\/span>/g)) {
    out.push(...words(match[1] ?? ''))
  }
  return out
}

/** Whether a query word is in the title. The strongest signal there is. */
export function titleMatches(title: string, terms: string[]): boolean {
  const titleWords = words(title)
  return terms.some((term) => titleWords.some((word) => alike(term, word)))
}

/**
 * Whether the page is *about* the query, rather than merely mentioning it.
 *
 * Wikipedia's search is generous: give it five words and it will find an article
 * containing one of them. That is how "social learning platform" once returned **Piper
 * Alpha**, an oil platform destroyed in 1988 — it matched "platform", and "learning"
 * from a paper cited in the references, and nothing else in the phrase. "social platform
 * postmortem" returned the article about a suicide, which is worse than useless.
 *
 * The rule: two matched words, because one is what an unrelated page looks like. The
 * words counted are Wikipedia's own — it marks what it matched in the excerpt — so this
 * still accepts a page whose title shares nothing with the query, which is exactly the
 * case for "stages of change" and *Transtheoretical model*.
 *
 * Deliberately blunt, because the costs are lopsided: showing nothing costs almost
 * nothing, since a move works without material and the card says so, while showing
 * something unrelated costs the person's trust in every other suggestion.
 */
export function looksRelevant(title: string, excerpt: string, terms: string[]): boolean {
  if (titleMatches(title, terms)) return true

  const marked = markedWords(excerpt)
  const matched = terms.filter((term) => marked.some((word) => alike(term, word))).length
  return matched >= (terms.length === 1 ? 1 : 2)
}

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
 * without material is still a perfectly good move, and null is much better than a page
 * about something else.
 */
export async function lookupTopic(
  query: string,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<LookupResult | null> {
  const trimmed = query.trim().slice(0, MAX_QUERY)
  if (trimmed.length < 2) return null

  const terms = queryTerms(trimmed)
  if (terms.length === 0) return null

  const fetcher = options.fetcher ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 8000)

  try {
    const res = await fetcher(
      `${SEARCH_ENDPOINT}?q=${encodeURIComponent(trimmed)}&limit=${CANDIDATES}`,
      {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          'user-agent': 'Inkling/0.1 (personal blip tool)',
        },
      },
    )
    if (!res.ok) return null

    const body = (await res.json()) as {
      pages?: Array<{ key?: string; title?: string; description?: string; excerpt?: string }>
    }

    const usable = (body.pages ?? [])
      .filter((page) => page.key && page.title)
      .map((page) => ({
        page,
        excerpt: page.excerpt ?? '',
        extract: stripHtml(page.excerpt ?? '').slice(0, 600),
      }))
      // A one-line stub is not worth putting in front of someone.
      .filter((candidate) => candidate.extract.length >= MIN_EXTRACT)

    // Wikipedia's own ranking is the best ordering available, so this only *rejects* —
    // it does not re-rank. An earlier version preferred any title match, which put
    // "Four stages of competence" ahead of "Transtheoretical model" for "stages of
    // change" purely because the word "stages" was in its title.
    for (const candidate of usable) {
      const title = candidate.page.title ?? ''
      if (!looksRelevant(title, candidate.excerpt, terms)) continue
      return {
        title,
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(candidate.page.key ?? '')}`,
        description: candidate.page.description?.trim() || null,
        extract: candidate.extract,
        source: 'wikipedia',
      }
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
