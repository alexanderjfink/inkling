import { describe, expect, test } from 'bun:test'
import type { Blip, BlipEvent, BlipEventBody, BlipType, LLMProvider } from '../src/index'
import {
  candidateTemplates,
  MOVE_LIBRARY,
  parseMoveResponse,
  project,
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

describe('toMoveSpec', () => {
  test('derives the playbook name from the template id', () => {
    const template = MOVE_LIBRARY.find((t) => t.id === 'quest.firstSession')
    if (!template) throw new Error('missing template')
    expect(toMoveSpec(template).playbook).toBe('quest')
  })
})
