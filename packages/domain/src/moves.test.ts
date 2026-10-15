import { describe, expect, test } from 'bun:test'
import type { Blip, BlipEvent, BlipEventBody, BlipType, LLMProvider } from '../src/index'
import {
  BLIP_TYPES,
  buildGuidancePrompt,
  buildMovePrompt,
  candidateTemplates,
  deriveQuery,
  MOVE_LIBRARY,
  parseGuidance,
  parseMoveResponse,
  project,
  requestGuidance,
  selectMove,
  toMoveSpec,
} from '../src/index'

function ev(body: BlipEventBody, seq: number, at: string): BlipEvent {
  return { ...body, deviceId: 'test-device', seq, at }
}

function makeBlip(type: BlipType, text: string, url?: string): Blip {
  const [blip] = project([
    ev(
      {
        t: 'captured',
        id: 'b1',
        input: url ? { kind: 'url', url, text } : { kind: 'text', text },
        type,
      },
      0,
      '2026-01-01T00:00:00Z',
    ),
  ])
  if (!blip) throw new Error('expected a blip')
  return blip
}

function blipFrom(events: BlipEvent[]): Blip {
  const [blip] = project(events)
  if (!blip) throw new Error('expected a blip')
  return blip
}

function fakeProvider(behaviour: {
  available?: boolean
  text?: string
  throws?: boolean
}): LLMProvider {
  return {
    name: 'fake',
    available: async () => behaviour.available ?? true,
    completeStructured: async () => {
      if (behaviour.throws) throw new Error('provider exploded')
      return behaviour.text ?? ''
    },
    embed: async () => [],
  }
}

describe('playbook', () => {
  test('every template is time-boxed, goal-bearing and short', () => {
    for (const template of MOVE_LIBRARY) {
      expect(template.timeLimitSec).toBeGreaterThanOrEqual(30)
      expect(template.timeLimitSec).toBeLessThanOrEqual(900)
      expect(template.goal.length).toBeGreaterThan(0)
      expect(template.title.length).toBeGreaterThan(0)
      expect(template.blipTypes.length).toBeGreaterThan(0)
    }
  })

  test('every blip type has at least two specific moves', () => {
    for (const type of ['question', 'reference', 'insight', 'idea', 'quest', 'yearning'] as const) {
      const specific = MOVE_LIBRARY.filter(
        (template) => template.blipTypes.length === 1 && template.blipTypes[0] === type,
      )
      expect(specific.length).toBeGreaterThanOrEqual(2)
    }
  })

  test('a url move is only offered when there is a url', () => {
    const withoutUrl = candidateTemplates({ blip: makeBlip('reference', 'a link I saved') })
    expect(withoutUrl.map((t) => t.id)).not.toContain('reference.firstLook')

    const withUrl = candidateTemplates({
      blip: makeBlip('reference', 'a link I saved', 'https://example.com/paper'),
    })
    expect(withUrl.map((t) => t.id)).toContain('reference.firstLook')
  })

  test('type-specific moves rank above generic ones', () => {
    const candidates = candidateTemplates({ blip: makeBlip('question', 'What are my principles?') })
    expect(candidates[0]?.blipTypes).toEqual(['question'])
  })

  test('moves already shown are not offered again', () => {
    const blip = makeBlip('question', 'What are my principles?')
    const first = candidateTemplates({ blip })
    const seen = [first[0]?.id ?? '']
    const second = candidateTemplates({ blip, seenMoveIds: seen })
    expect(second.map((t) => t.id)).not.toContain(first[0]?.id)
  })

  test('when every move has been seen, it starts over rather than returning nothing', () => {
    const blip = makeBlip('question', 'What are my principles?')
    const all = MOVE_LIBRARY.filter((t) => t.blipTypes.includes('question')).map((t) => t.id)
    expect(candidateTemplates({ blip, seenMoveIds: all }).length).toBeGreaterThan(0)
  })
})

describe('parseMoveResponse', () => {
  const candidates = candidateTemplates({ blip: makeBlip('idea', 'an idea I had') })
  const goodId = candidates[0]?.id ?? 'idea.variations'

  test('accepts a well-formed reply', () => {
    const spec = parseMoveResponse(
      JSON.stringify({
        id: goodId,
        title: 'Sketch three takes',
        why: 'rough is fine',
        goal: 'three takes',
        timeLimitSec: 200,
      }),
      candidates,
    )
    expect(spec?.generatedBy).toBe('llm')
    expect(spec?.title).toBe('Sketch three takes')
    expect(spec?.timeLimitSec).toBe(200)
    expect(spec?.playbook).toBe(goodId.split('.')[0])
  })

  test('tolerates prose and code fences around the JSON', () => {
    const text = `Sure! Here is a move:\n\`\`\`json\n{"id":"${goodId}","title":"t","goal":"g"}\n\`\`\`\nHope that helps.`
    expect(parseMoveResponse(text, candidates)?.title).toBe('t')
  })

  test('rejects a move that is not on the menu', () => {
    const spec = parseMoveResponse(
      JSON.stringify({ id: 'invented.dangerous', title: 't', goal: 'g' }),
      candidates,
    )
    expect(spec).toBeNull()
  })

  test('rejects a reply with no usable goal', () => {
    expect(parseMoveResponse(JSON.stringify({ id: goodId, title: 't' }), candidates)).toBeNull()
    expect(
      parseMoveResponse(JSON.stringify({ id: goodId, title: '', goal: '  ' }), candidates),
    ).toBeNull()
  })

  test('rejects junk entirely', () => {
    expect(parseMoveResponse('I could not think of anything.', candidates)).toBeNull()
    expect(parseMoveResponse('{ not json', candidates)).toBeNull()
  })

  test('clamps an absurd time limit', () => {
    const spec = parseMoveResponse(
      JSON.stringify({ id: goodId, title: 't', goal: 'g', timeLimitSec: 99999 }),
      candidates,
    )
    expect(spec?.timeLimitSec).toBe(900)
  })

  test('falls back to the template time limit when none is given', () => {
    const spec = parseMoveResponse(
      JSON.stringify({ id: goodId, title: 't', goal: 'g' }),
      candidates,
    )
    expect(spec?.timeLimitSec).toBe(candidates[0]?.timeLimitSec)
  })
})

describe('selectMove', () => {
  const blip = makeBlip('idea', 'a button to show the moment before a tab was opened')

  test('without a provider, it uses the playbook', async () => {
    const move = await selectMove({ blip })
    expect(move.generatedBy).toBe('playbook')
    expect(move.timeLimitSec).toBeGreaterThan(0)
  })

  test('falls back when the provider is unavailable', async () => {
    const move = await selectMove({ blip }, { provider: fakeProvider({ available: false }) })
    expect(move.generatedBy).toBe('playbook')
  })

  test('falls back when the provider throws', async () => {
    const move = await selectMove({ blip }, { provider: fakeProvider({ throws: true }) })
    expect(move.generatedBy).toBe('playbook')
  })

  test('falls back when the provider returns an unusable reply', async () => {
    const move = await selectMove({ blip }, { provider: fakeProvider({ text: 'no idea sorry' }) })
    expect(move.generatedBy).toBe('playbook')
  })

  test('uses an adapted move when the provider behaves', async () => {
    const candidate = candidateTemplates({ blip })[0]
    const text = JSON.stringify({
      id: candidate?.id,
      title: 'Sketch three variations, but start with the silliest',
      why: 'silly first loosens the rest',
      goal: 'three variations',
    })
    const move = await selectMove({ blip }, { provider: fakeProvider({ text }) })
    expect(move.generatedBy).toBe('llm')
    expect(move.title).toContain('silliest')
  })
})

describe('moves that bring something to read', () => {
  test('the playbook has some, and they are offered for ordinary blips', () => {
    const material = MOVE_LIBRARY.filter((template) => template.wantsMaterial)
    expect(material.length).toBeGreaterThanOrEqual(4)
    expect(material.some((template) => template.blipTypes.length === BLIP_TYPES.length)).toBe(true)
  })

  test('a move that looks something up gets the model query', async () => {
    const blip = makeBlip('question', 'What is the transtheoretical model?')
    const candidates = candidateTemplates({ blip })
    const wants = candidates.find((template) => template.wantsMaterial)
    if (!wants) throw new Error('no material move available')

    const text = JSON.stringify({
      id: wants.id,
      title: 'Look up the stages of change',
      goal: 'one thing you did not know',
      query: 'transtheoretical model stages of change',
    })
    const move = await selectMove({ blip }, { provider: fakeProvider({ text }) })
    expect(move.materialQuery).toBe('transtheoretical model stages of change')
  })

  test('a query is ignored for a move that does not look anything up', () => {
    const candidates = candidateTemplates({ blip: makeBlip('idea', 'an idea') })
    const plain = candidates.find((template) => !template.wantsMaterial)
    if (!plain) throw new Error('no plain move available')

    const spec = parseMoveResponse(
      JSON.stringify({ id: plain.id, title: 't', goal: 'g', query: 'sneaky' }),
      candidates,
    )
    expect(spec?.materialQuery).toBeUndefined()
  })

  test('the query falls back to the blip when the model omits one', async () => {
    const blip = makeBlip('question', 'What is the transtheoretical model?')
    const candidates = candidateTemplates({ blip })
    const wants = candidates.find((template) => template.wantsMaterial)
    if (!wants) throw new Error('no material move available')

    const text = JSON.stringify({ id: wants.id, title: 't', goal: 'g' })
    const move = await selectMove({ blip }, { provider: fakeProvider({ text }) })
    expect(move.materialQuery).toBeTruthy()
    expect(move.materialQuery).toContain('transtheoretical')
  })

  test('an over-long query is trimmed', () => {
    const candidates = candidateTemplates({ blip: makeBlip('question', 'a question?') })
    const wants = candidates.find((template) => template.wantsMaterial)
    if (!wants) throw new Error('no material move available')
    const spec = parseMoveResponse(
      JSON.stringify({ id: wants.id, title: 't', goal: 'g', query: 'x'.repeat(400) }),
      candidates,
    )
    expect(spec?.materialQuery?.length).toBeLessThanOrEqual(120)
  })

  test('the prompt tells the model it may supply a query, and never a URL', () => {
    const blip = makeBlip('question', 'a question?')
    const { system, prompt } = buildMovePrompt({ blip }, candidateTemplates({ blip }))
    expect(system).toContain('search phrase')
    expect(system).toContain('Never invent a URL')
    expect(prompt).toContain('looks something up: yes')
    expect(prompt).toContain('"query"')
  })
})

describe('move history', () => {
  const spec = toMoveSpec(MOVE_LIBRARY[0]!)

  test('a completed move records when it was done', () => {
    const blip = blipFrom([
      ev(
        { t: 'captured', id: 'b1', input: { kind: 'text', text: 'a thought' }, type: 'idea' },
        0,
        '2026-01-01T00:00:00Z',
      ),
      ev({ t: 'moveShown', id: 'b1', moveId: spec.id, moveSpec: spec }, 1, '2026-01-02T09:00:00Z'),
      ev({ t: 'moveDone', id: 'b1', moveId: spec.id }, 2, '2026-01-02T09:04:00Z'),
    ])
    const move = blip.moves[0]
    expect(move?.outcome).toBe('done')
    expect(move?.shownAt).toBe('2026-01-02T09:00:00Z')
    expect(move?.doneAt).toBe('2026-01-02T09:04:00Z')
  })

  test('a move that was only offered has no completion time', () => {
    const blip = blipFrom([
      ev(
        { t: 'captured', id: 'b1', input: { kind: 'text', text: 'a thought' }, type: 'idea' },
        0,
        '2026-01-01T00:00:00Z',
      ),
      ev({ t: 'moveShown', id: 'b1', moveId: spec.id, moveSpec: spec }, 1, '2026-01-02T09:00:00Z'),
    ])
    expect(blip.moves[0]?.outcome).toBe('shown')
    expect(blip.moves[0]?.doneAt).toBeUndefined()
  })

  test('moves already offered are not offered again', () => {
    const blip = makeBlip('idea', 'an idea')
    const first = candidateTemplates({ blip })
    const seen = first.slice(0, 3).map((template) => template.id)
    const next = candidateTemplates({ blip, seenMoveIds: seen })
    for (const id of seen) expect(next.map((template) => template.id)).not.toContain(id)
  })

  test('the prompt tells the model what it has already offered, and not to repeat', () => {
    const blip = blipFrom([
      ev(
        { t: 'captured', id: 'b1', input: { kind: 'text', text: 'a thought' }, type: 'question' },
        0,
        '2026-01-01T00:00:00Z',
      ),
      ev({ t: 'moveShown', id: 'b1', moveId: spec.id, moveSpec: spec }, 1, '2026-01-02T09:00:00Z'),
      ev({ t: 'moveDone', id: 'b1', moveId: spec.id }, 2, '2026-01-02T09:04:00Z'),
    ])
    const { prompt } = buildMovePrompt({ blip }, candidateTemplates({ blip }))
    expect(prompt).toContain('MOVES ALREADY PUT IN FRONT OF THEM')
    expect(prompt).toContain('done')
    expect(prompt).toContain('Do not repeat a move')
  })
})

describe('deriveQuery', () => {
  test('uses the title, minus any URL', () => {
    const blip = makeBlip('reference', 'I would love to learn to draw https://drawabox.com/')
    const query = deriveQuery(blip)
    expect(query).not.toContain('http')
    expect(query).toContain('learn to draw')
  })

  test('falls back to topics when the title is only a URL', () => {
    const blip = makeBlip('reference', 'https://example.com/thing', 'https://example.com/thing')
    const query = deriveQuery(blip)
    expect(query.length).toBeGreaterThan(0)
  })

  test('is never longer than a search phrase', () => {
    const blip = makeBlip('idea', 'x'.repeat(400))
    expect(deriveQuery(blip).length).toBeLessThanOrEqual(120)
  })
})

describe('guidance', () => {
  test('keeps a useful item that runs long, rather than dropping it', () => {
    // The first real reply had four items of ~205 characters, and a 200-character
    // limit silently discarded every one of them.
    const long = `Notice whether the app's suggestions spread socially because users tell each other about them, or because the algorithm itself reaches out to new people — only the first is a mechanism you could copy for Inkling.`
    expect(long.length).toBeGreaterThan(200)
    const items = parseGuidance(JSON.stringify({ items: [long] }))
    expect(items).toHaveLength(1)
    expect(items?.[0]).toContain('Notice whether')
  })

  test('trims only an absurdly long item', () => {
    const items = parseGuidance(JSON.stringify({ items: ['x'.repeat(2000)] }))
    expect(items?.[0]?.length ?? 0).toBeLessThanOrEqual(320)
  })

  test('rejects junk, empties, and a reply with no items', () => {
    expect(parseGuidance('no idea')).toBeNull()
    expect(parseGuidance('{"items":[]}')).toBeNull()
    expect(parseGuidance('{"items":["  "]}')).toBeNull()
    expect(parseGuidance('{"nope":true}')).toBeNull()
  })

  test('caps at four', () => {
    expect(parseGuidance(JSON.stringify({ items: ['a', 'b', 'c', 'd', 'e'] }))).toHaveLength(4)
  })

  test('the prompt asks for one short sentence each', () => {
    const blip = makeBlip('idea', 'an idea')
    const { system } = buildGuidancePrompt({ blip })
    expect(system).toContain('20 words')
    expect(system).toContain('never generic advice')
  })

  test('without a provider there is simply no guidance', async () => {
    const blip = makeBlip('idea', 'an idea')
    expect(await requestGuidance({ blip })).toBeNull()
  })

  test('asking from inside the move includes what they have started writing', () => {
    const blip = makeBlip('idea', 'an idea')
    const { prompt } = buildGuidancePrompt({ blip, draft: 'FRESS was a hypertext system' })
    expect(prompt).toContain('STARTED WRITING JUST NOW')
    expect(prompt).toContain('FRESS was a hypertext system')
    expect(prompt).toContain('do not repeat it back')
  })

  test('asking again is told what was already said, and asks for something new', () => {
    const blip = makeBlip('idea', 'an idea')
    const { system, prompt } = buildGuidancePrompt({
      blip,
      previous: ['Check what FRESS missed'],
    })
    expect(prompt).toContain('ADVICE THEY ALREADY HAVE')
    expect(prompt).toContain('Check what FRESS missed')
    expect(system).toContain('different, more specific angles')
  })

  test('a blank draft is not sent as if it were writing', () => {
    const blip = makeBlip('idea', 'an idea')
    const { prompt } = buildGuidancePrompt({ blip, draft: '   ' })
    expect(prompt).not.toContain('STARTED WRITING JUST NOW')
  })
})

describe('toMoveSpec', () => {
  test('derives the playbook name from the template id', () => {
    const template = MOVE_LIBRARY.find((t) => t.id === 'quest.firstSession')
    if (!template) throw new Error('missing template')
    expect(toMoveSpec(template).playbook).toBe('quest')
  })
})
