import { describe, expect, test } from 'bun:test'
import { lookupTopic } from './lookup'

const LONG_ENOUGH =
  'that the stages of change are analogues of other models, and that interventions differ by stage'

function stubFetcher(pages: unknown, status = 200) {
  const calls: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    calls.push(String(input))
    return status === 200 ? Response.json({ pages }) : new Response('nope', { status })
  }) as unknown as typeof fetch
  return { fetcher, calls }
}

describe('lookupTopic', () => {
  test('finds a page and strips the search highlight markup', async () => {
    const { fetcher, calls } = stubFetcher([
      {
        key: 'Transtheoretical_model',
        title: 'Transtheoretical model',
        description: 'Integrative theory of therapy',
        excerpt: `that the <span class="searchmatch">stages</span> of change are analogues of other models, and that interventions differ`,
      },
    ])

    const result = await lookupTopic('stages of change', { fetcher })
    expect(result?.title).toBe('Transtheoretical model')
    expect(result?.url).toBe('https://en.wikipedia.org/wiki/Transtheoretical_model')
    expect(result?.description).toBe('Integrative theory of therapy')
    expect(result?.extract).not.toContain('<span')
    expect(result?.extract).toContain('stages of change')
    expect(calls[0]).toContain('q=stages%20of%20change')
  })

  test('decodes the entities a search excerpt comes with', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'K',
        title: 'T',
        excerpt: `a &quot;quoted&quot; phrase, Rogers&#039; theory, an &amp; sign, and &#x2014; a dash, ${LONG_ENOUGH}`,
      },
    ])
    const result = await lookupTopic('x y', { fetcher })
    expect(result?.extract).toContain('"quoted"')
    expect(result?.extract).toContain("Rogers' theory")
    expect(result?.extract).toContain('&')
    expect(result?.extract).toContain('—')
    expect(result?.extract).not.toContain('&#')
  })

  test('returns null rather than throwing when the search fails', async () => {
    const { fetcher } = stubFetcher([], 500)
    expect(await lookupTopic('anything', { fetcher })).toBeNull()
  })

  test('returns null when there are no results at all', async () => {
    const { fetcher } = stubFetcher([])
    expect(await lookupTopic('zzzzz', { fetcher })).toBeNull()
  })

  test('ignores a stub too short to be worth putting in front of someone', async () => {
    const { fetcher } = stubFetcher([{ key: 'X', title: 'X', excerpt: 'too short' }])
    expect(await lookupTopic('x', { fetcher })).toBeNull()
  })

  test('refuses an empty query without calling out', async () => {
    const { fetcher, calls } = stubFetcher([{ key: 'X', title: 'X', excerpt: LONG_ENOUGH }])
    expect(await lookupTopic('   ', { fetcher })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  test('bounds an absurdly long query', async () => {
    const { fetcher, calls } = stubFetcher([{ key: 'X', title: 'X', excerpt: LONG_ENOUGH }])
    await lookupTopic('a'.repeat(500), { fetcher })
    expect(calls[0]?.length).toBeLessThan(500)
  })
})
