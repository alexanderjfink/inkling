import { describe, expect, test } from 'bun:test'
import { lookupTopic, queryTerms } from './lookup'

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
    // The real excerpt for this search. Note that neither "stages" nor "change" appears
    // in the title or the description — Wikipedia matched them in the article body, and
    // marks which words it matched.
    const { fetcher, calls } = stubFetcher([
      {
        key: 'Transtheoretical_model',
        title: 'Transtheoretical model',
        description: 'Integrative theory of therapy',
        excerpt:
          'processes <span class="searchmatch">of</span> <span class="searchmatch">change</span> to guide the individual. The model is composed <span class="searchmatch">of</span> constructs such as: <span class="searchmatch">stages</span> of change, decisional balance, self-efficacy',
      },
    ])

    const result = await lookupTopic('stages of change', { fetcher })
    expect(result?.title).toBe('Transtheoretical model')
    expect(result?.url).toBe('https://en.wikipedia.org/wiki/Transtheoretical_model')
    expect(result?.description).toBe('Integrative theory of therapy')
    expect(result?.extract).not.toContain('<span')
    expect(result?.extract).toContain('decisional balance')
    expect(calls[0]).toContain('q=stages%20of%20change')
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
        key: 'Supernormal',
        title: 'Supernormal',
        description: 'Video game',
        excerpt: `the <span class="searchmatch">Supernormal</span> game ${LONG_ENOUGH}`,
      },
    ])
    expect((await lookupTopic('Ursidice Supernormal who made it', { fetcher }))?.title).toBe(
      'Supernormal',
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
      { key: 'Drawabox', title: 'Drawabox', description: 'Drawing course', excerpt: LONG_ENOUGH },
    ])
    expect(
      (await lookupTopic('drawabox review from someone who finished', { fetcher }))?.title,
    ).toBe('Drawabox')
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
    expect(queryTerms('Ursidice Supernormal who made it')).toEqual(['ursidice', 'supernormal'])
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
    // "Better Living Through Algorithms Kritzer summary" returned "Robbie (short story)",
    // because Robbie's article contains an awards table listing the title. Wikipedia puts
    // the real article first; the job here is only to reject, never to re-rank.
    const { fetcher } = stubFetcher([
      {
        key: 'Better_Living_Through_Algorithms',
        title: 'Better Living Through Algorithms',
        description: 'Short story by Naomi Kritzer',
        excerpt: `a <span class="searchmatch">short</span> <span class="searchmatch">story</span> ${LONG_ENOUGH}`,
      },
      {
        key: 'Robbie_(short_story)',
        title: 'Robbie (short story)',
        description: 'Science fiction short story by American writer Isaac Asimov',
        excerpt:
          'Pinsker (2022) &quot;Rabbit Test&quot; by Samantha Mills (2023) &quot;<span class="searchmatch">Better</span> <span class="searchmatch">Living</span> <span class="searchmatch">Through</span> <span class="searchmatch">Algorithms</span>&quot;',
      },
    ])
    const result = await lookupTopic('Better Living Through Algorithms Kritzer summary', {
      fetcher,
    })
    expect(result?.title).toBe('Better Living Through Algorithms')
  })

  test('a better-ranked page is not displaced by a worse one with a matching title', async () => {
    // The regression this guards: preferring title matches put "Four stages of
    // competence" ahead of "Transtheoretical model" for "stages of change", purely
    // because the word "stages" happened to be in its title.
    const { fetcher } = stubFetcher([
      {
        key: 'Transtheoretical_model',
        title: 'Transtheoretical model',
        description: 'Integrative theory of therapy',
        excerpt:
          'processes <span class="searchmatch">of</span> <span class="searchmatch">change</span> to guide the individual, composed of <span class="searchmatch">stages</span>',
      },
      {
        key: 'Four_stages_of_competence',
        title: 'Four stages of competence',
        description: 'Psychological states when gaining a skill',
        excerpt:
          'the four <span class="searchmatch">stages</span> <span class="searchmatch">of</span> competence relates to psychological states',
      },
    ])
    expect((await lookupTopic('stages of change', { fetcher }))?.title).toBe(
      'Transtheoretical model',
    )
  })
})
