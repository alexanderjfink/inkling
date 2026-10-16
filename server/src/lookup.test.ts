import { describe, expect, test } from 'bun:test'
import { lookupTopic, queryTerms, resolveLookUps } from './lookup'

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
    // Neither "bread" nor "rise" is in the title, so this covers the case that matters
    // most as well: Wikipedia marks which words it matched, and the right page need not
    // share any word with the query.
    const { fetcher, calls } = stubFetcher([
      {
        key: 'Yeast',
        title: 'Yeast',
        description: 'Eukaryotic, single-celled microorganisms',
        excerpt:
          'a leavening agent: the dough <span class="searchmatch">rises</span> because the <span class="searchmatch">bread</span> traps gas produced as the yeast feeds',
      },
    ])

    const result = await lookupTopic('what makes bread rise', { fetcher })
    expect(result?.title).toBe('Yeast')
    expect(result?.url).toBe('https://en.wikipedia.org/wiki/Yeast')
    expect(result?.description).toBe('Eukaryotic, single-celled microorganisms')
    expect(result?.extract).not.toContain('<span')
    expect(result?.extract).toContain('leavening agent')
    expect(calls[0]).toContain('q=what%20makes%20bread%20rise')
  })

  test('decodes the entities a search excerpt comes with', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'K',
        title: 'T',
        excerpt: `a &quot;quoted&quot; phrase, <span class="searchmatch">Rogers</span>&#039; <span class="searchmatch">theory</span>, an &amp; sign, and &#x2014; a dash, ${LONG_ENOUGH}`,
      },
    ])
    const result = await lookupTopic('rogers theory', { fetcher })
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

/**
 * The pages this actually returned, taken from the live API.
 *
 * Every one of these was a real answer to a real search phrase, and every one of them
 * is wrong. A move is a prompt to go and look at something; sending someone to an oil
 * platform disaster because the word "platform" appeared is worse than sending them
 * nowhere, because it makes every other suggestion look untrustworthy too.
 */
describe('relevance — the failures that prompted this', () => {
  test('"social learning platform" does not return Piper Alpha, an oil platform', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'Piper_Alpha',
        title: 'Piper Alpha',
        description: 'Oil platform destroyed by explosion and fire in 1988',
        excerpt:
          'eISSN 1878-0504. Paté-Cornell, M. Elisabeth (April 1993). "Learning from the <span class="searchmatch">Piper Alpha</span> Accident: A Postmortem Analysis of Technical and Organizational Factors"',
      },
      {
        key: 'Social_learning',
        title: 'Social learning (social pedagogy)',
        description: '',
        excerpt:
          '<span class="searchmatch">Social</span> <span class="searchmatch">learning</span> (social pedagogy) is learning that takes place at a wider scale than individual or group learning',
      },
    ])
    const result = await lookupTopic('social learning platform', { fetcher })
    expect(result?.title).toBe('Social learning (social pedagogy)')
  })

  test('a page matching only one word of a phrase is refused, and nothing is returned', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'Piper_Alpha',
        title: 'Piper Alpha',
        description: 'Oil platform destroyed by explosion and fire in 1988',
        excerpt:
          'Paté-Cornell, M. Elisabeth (April 1993). "Learning from the <span class="searchmatch">Piper Alpha</span> Accident: A Postmortem Analysis"',
      },
    ])
    expect(await lookupTopic('social learning platform', { fetcher })).toBeNull()
  })

  test('"social platform postmortem" does not return the article about a suicide', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'Suicide_of_Sushant_Singh_Rajput',
        title: 'Suicide of Sushant Singh Rajput',
        description: '2020 death of Indian actor',
        excerpt:
          'Mumbai, aged 34. The cause of death was ruled as suicide, with official <span class="searchmatch">postmortem</span> reports confirming Rajput died of asphyxia due to hanging',
      },
    ])
    expect(await lookupTopic('social platform postmortem', { fetcher })).toBeNull()
  })

  test('"…what it missed" does not return the Dead Internet theory', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'Dead_Internet_theory',
        title: 'Dead Internet theory',
        description: 'Concept involving online bot activity',
        excerpt:
          'attention with a September 2021 article in The Atlantic titled Maybe You <span class="searchmatch">Missed</span> <span class="searchmatch">It</span>, but the Internet &#039;Died&#039; Five Years Ago',
      },
    ])
    expect(await lookupTopic('social learning platform what it missed', { fetcher })).toBeNull()
  })

  test('a query that is nothing but question words is refused rather than guessed at', async () => {
    const { fetcher, calls } = stubFetcher([
      { key: 'X', title: 'X', excerpt: `<span class="searchmatch">who</span> ${LONG_ENOUGH}` },
    ])
    expect(await lookupTopic('who made it', { fetcher })).toBeNull()
    expect(calls).toHaveLength(0)
  })

  test('the first result is skipped and a later one is used, rather than giving up', async () => {
    const { fetcher } = stubFetcher([
      { key: 'Piper_Alpha', title: 'Piper Alpha', excerpt: `learning ${LONG_ENOUGH}` },
      {
        key: 'Shipping_container',
        title: 'Shipping container',
        description: 'Standardised steel box for intermodal freight',
        excerpt: `the <span class="searchmatch">shipping</span> <span class="searchmatch">container</span> ${LONG_ENOUGH}`,
      },
    ])
    expect((await lookupTopic('who invented the shipping container', { fetcher }))?.title).toBe(
      'Shipping container',
    )
  })
})

describe('relevance — the good results that must keep working', () => {
  test('a distinctive single word matches on the title', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'Dynamicland',
        title: 'Dynamicland',
        description: 'Research project',
        excerpt: `<span class="searchmatch">Dynamicland</span> is a ${LONG_ENOUGH}`,
      },
    ])
    expect((await lookupTopic('Bret Victor Dynamicland why Realtalk', { fetcher }))?.title).toBe(
      'Dynamicland',
    )
  })

  test('a title match does not need the highlight markup to be understood', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'Drawing',
        title: 'Drawing',
        description: 'Visual art made with instruments',
        excerpt: LONG_ENOUGH,
      },
    ])
    expect(
      (await lookupTopic('a drawing course review from someone who finished', { fetcher }))?.title,
    ).toBe('Drawing')
  })

  test('a single-word query is allowed one match — it has only one word to match', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'Postmortem',
        title: 'Postmortem',
        description: 'Examination after death',
        excerpt: `an <span class="searchmatch">postmortem</span> is ${LONG_ENOUGH}`,
      },
    ])
    expect((await lookupTopic('postmortem', { fetcher }))?.title).toBe('Postmortem')
  })

  test('plurals and suffixes still count as a match', async () => {
    const { fetcher } = stubFetcher([
      {
        key: 'Algorithm',
        title: 'Algorithm',
        description: 'Procedure',
        excerpt: `<span class="searchmatch">algorithms</span> are ${LONG_ENOUGH}`,
      },
    ])
    expect((await lookupTopic('algorithms explained', { fetcher }))?.title).toBe('Algorithm')
  })
})

describe('queryTerms', () => {
  test('question words and filler are dropped, the subject is kept', () => {
    expect(queryTerms('who invented the shipping container')).toEqual([
      'invented',
      'shipping',
      'container',
    ])
    expect(queryTerms('who already tried a social learning platform')).toEqual([
      'social',
      'learning',
      'platform',
    ])
  })

  test('a query with no subject at all has no terms', () => {
    expect(queryTerms('who made it')).toEqual([])
    expect(queryTerms('the and of')).toEqual([])
    expect(queryTerms('a b')).toEqual([])
  })

  test('duplicates are collapsed, so one repeated word cannot look like two matches', () => {
    expect(queryTerms('drawing drawing drawing')).toEqual(['drawing'])
  })
})

describe('a page that merely mentions the phrase', () => {
  test('Wikipedia ranking is followed — the article about the thing wins when it is first', async () => {
    // A page that lists a title in a table of award winners reads, to a word match, the
    // same as a page about it. Wikipedia ranks the real article first; the job here is
    // only to reject, never to re-rank.
    const { fetcher } = stubFetcher([
      {
        key: 'The_Yellow_Wallpaper',
        title: 'The Yellow Wallpaper',
        description: 'Short story by Charlotte Perkins Gilman',
        excerpt: `a <span class="searchmatch">short</span> <span class="searchmatch">story</span> ${LONG_ENOUGH}`,
      },
      {
        key: 'American_literature',
        title: 'American literature',
        description: 'Literature written in the United States',
        excerpt:
          'the canon includes &quot;<span class="searchmatch">The</span> <span class="searchmatch">Yellow</span> <span class="searchmatch">Wallpaper</span>&quot; and other works',
      },
    ])
    const result = await lookupTopic('The Yellow Wallpaper short story summary', {
      fetcher,
    })
    expect(result?.title).toBe('The Yellow Wallpaper')
  })

  test('a better-ranked page is not displaced by a worse one with a matching title', async () => {
    // The regression this guards: preferring title matches put a page ahead of the right
    // one purely because a word of the query happened to be in its title.
    const { fetcher } = stubFetcher([
      {
        key: 'Yeast',
        title: 'Yeast',
        description: 'Eukaryotic, single-celled microorganisms',
        excerpt: `the <span class="searchmatch">bread</span> <span class="searchmatch">rises</span> as the yeast feeds. ${LONG_ENOUGH}`,
      },
      {
        key: 'Bread',
        title: 'Bread',
        description: 'Staple food made from dough',
        excerpt: `the <span class="searchmatch">bread</span> is baked once it <span class="searchmatch">rises</span>. ${LONG_ENOUGH}`,
      },
    ])
    expect((await lookupTopic('what makes bread rise', { fetcher }))?.title).toBe('Yeast')
  })
})

describe('resolveLookUps', () => {
  /**
   * A fetcher whose answer depends on the phrase, so a mixed batch can be tested.
   *
   * Matched on the whole `q=` value rather than a substring: "best starter MIDI keyboard"
   * contains "MIDI keyboard", so a substring match would answer the first phrase with the
   * second phrase's page and the test would pass for the wrong reason.
   */
  function perQuery(map: Record<string, unknown[]>) {
    const fetcher = (async (input: string | URL | Request) => {
      const asked = new URL(String(input)).searchParams.get('q') ?? ''
      return Response.json({ pages: map[asked] ?? [] })
    }) as unknown as typeof fetch
    return fetcher
  }

  const PAGE = [
    {
      key: 'MIDI_keyboard',
      title: 'MIDI keyboard',
      description: 'Musical keyboard that sends MIDI',
      excerpt:
        'A <span class="searchmatch">MIDI</span> <span class="searchmatch">keyboard</span> is a piano-style keyboard that sends MIDI data to a computer or phone',
    },
  ]

  test('a phrase that lands on a page becomes a link to that page', async () => {
    const { links, material } = await resolveLookUps(['MIDI keyboard'], {
      fetcher: perQuery({ 'MIDI keyboard': PAGE }),
    })
    expect(links).toEqual([
      {
        label: 'MIDI keyboard',
        url: 'https://en.wikipedia.org/wiki/MIDI_keyboard',
        kind: 'reference',
      },
    ])
    expect(material?.title).toBe('MIDI keyboard')
    expect(material?.extract).toContain('sends MIDI data')
  })

  test('a phrase that lands on nothing becomes a search, not nothing at all', async () => {
    // "best starter MIDI keyboard" is not an encyclopaedia article and should not be.
    // The move still sends you somewhere; it just says which kind of somewhere.
    const { links, material } = await resolveLookUps(['best starter MIDI keyboard'], {
      fetcher: perQuery({}),
    })
    expect(links).toEqual([
      {
        label: 'best starter MIDI keyboard',
        url: 'https://duckduckgo.com/?q=best%20starter%20MIDI%20keyboard',
        kind: 'search',
      },
    ])
    expect(material).toBeNull()
  })

  test('a mixed batch keeps the order, and each link says what it is', async () => {
    const { links, material } = await resolveLookUps(
      ['best starter MIDI keyboard', 'MIDI keyboard', 'latency'],
      { fetcher: perQuery({ 'MIDI keyboard': PAGE }) },
    )
    expect(links.map((link) => link.kind)).toEqual(['search', 'reference', 'search'])
    expect(links[1]?.url).toBe('https://en.wikipedia.org/wiki/MIDI_keyboard')
    expect(material?.title).toBe('MIDI keyboard')
  })

  test('the first page found is the one worth reading', async () => {
    const other = [
      {
        key: 'Latency_(audio)',
        title: 'Latency (audio)',
        description: 'Delay in audio systems',
        excerpt:
          'audio <span class="searchmatch">latency</span> is the delay between an input and the sound it produces being heard',
      },
    ]
    const { links, material } = await resolveLookUps(['MIDI keyboard', 'latency'], {
      fetcher: perQuery({ 'MIDI keyboard': PAGE, latency: other }),
    })
    expect(links).toHaveLength(2)
    expect(material?.title).toBe('MIDI keyboard')
  })

  test('blank phrases are dropped, and no more than three are kept', async () => {
    const { links } = await resolveLookUps(['', '  ', 'one', 'two', 'three', 'four'], {
      fetcher: perQuery({}),
    })
    expect(links.map((link) => link.label)).toEqual(['one', 'two', 'three'])
  })

  test('an unreachable source still produces search links rather than losing them', async () => {
    const broken = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    const { links } = await resolveLookUps(['MIDI keyboard'], { fetcher: broken })
    expect(links[0]?.kind).toBe('search')
  })
})
