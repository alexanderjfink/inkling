import { describe, expect, test } from 'bun:test'
import type { Blip, BlipEvent, BlipEventBody, BlipType } from '../src/index'
import {
  blipText,
  cosine,
  jaccard,
  project,
  relatedness,
  sharedTopics,
  tokens,
  topRelated,
} from '../src/index'

let seq = 0
function ev(body: BlipEventBody, at: string, deviceId = 'test'): BlipEvent {
  seq += 1
  return { ...body, deviceId, seq, at }
}

function blip(id: string, text: string, type: BlipType = 'idea', topics: string[] = []): Blip {
  const [made] = project([
    ev({ t: 'captured', id, input: { kind: 'text', text }, type, topics }, '2026-01-01T00:00:00Z'),
  ])
  if (!made) throw new Error('expected a blip')
  return made
}

function linked(from: Blip, to: Blip): Blip {
  const [made] = project([
    ev(
      { t: 'captured', id: from.id, input: { kind: 'text', text: from.title }, type: from.type },
      '2026-01-01T00:00:00Z',
    ),
    ev(
      { t: 'captured', id: to.id, input: { kind: 'text', text: to.title }, type: to.type },
      '2026-01-01T00:00:01Z',
    ),
    ev({ t: 'linked', id: from.id, otherId: to.id }, '2026-01-01T00:00:02Z'),
  ])
  if (!made) throw new Error('expected a blip')
  return made
}

describe('text similarity helpers', () => {
  test('tokens drop stop words and short words', () => {
    const set = tokens('the stages of change theory is about change')
    expect(set.has('the')).toBe(false)
    expect(set.has('stages')).toBe(true)
    expect(set.has('change')).toBe(true)
  })

  test('jaccard is 0 for disjoint, 1 for identical', () => {
    expect(jaccard(tokens('alpha beta'), tokens('gamma delta'))).toBe(0)
    expect(jaccard(tokens('alpha beta'), tokens('alpha beta'))).toBe(1)
  })

  test('cosine handles identical, orthogonal and empty vectors', () => {
    expect(cosine([1, 0], [1, 0])).toBeCloseTo(1)
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0)
    expect(cosine([], [])).toBe(0)
    expect(cosine([0, 0], [1, 1])).toBe(0)
  })
})

describe('relatedness', () => {
  test('an explicit link is the strongest signal', () => {
    const a = blip('a', 'something about tea')
    const b = blip('b', 'a completely different subject')
    const linkedA = linked(a, b)
    const { score, reasons } = relatedness(linkedA, b)
    expect(score).toBeGreaterThanOrEqual(1)
    expect(reasons).toContain('you linked them')
  })

  test('shared topics count, and are named', () => {
    const a = blip('a', 'first', 'idea', ['timeful texts', 'memory'])
    const b = blip('b', 'second', 'idea', ['timeful texts'])
    const { score, reasons } = relatedness(a, b)
    expect(score).toBeGreaterThan(0)
    expect(reasons.some((reason) => reason.includes('timeful texts'))).toBe(true)
    expect(sharedTopics(a, b)).toEqual(['timeful texts'])
  })

  test('similar wording counts even with no topics', () => {
    const a = blip('a', 'stages of change theory interventions')
    const b = blip('b', 'change theory interventions and stages')
    expect(relatedness(a, b).score).toBeGreaterThan(0)
  })

  test('unrelated blips score zero', () => {
    const a = blip('a', 'drawing exercises for beginners')
    const b = blip('b', 'singing harmony with friends')
    expect(relatedness(a, b).score).toBe(0)
  })

  test('embeddings add meaning when the wording differs', () => {
    const a = blip('a', 'drawing exercises for beginners')
    const b = blip('b', 'singing harmony with friends')
    expect(relatedness(a, b).score).toBe(0)

    const embeddings = new Map([
      ['a', [1, 0, 0]],
      ['b', [0.99, 0.1, 0]],
    ])
    const withVectors = relatedness(a, b, { embeddings })
    expect(withVectors.score).toBeGreaterThan(0)
    expect(withVectors.reasons).toContain('similar in meaning')
  })

  test('a weak embedding similarity is ignored rather than forced', () => {
    const a = blip('a', 'drawing exercises')
    const b = blip('b', 'singing harmony')
    const embeddings = new Map([
      ['a', [1, 0]],
      ['b', [0.4, 0.9]],
    ])
    expect(relatedness(a, b, { embeddings }).score).toBe(0)
  })

  test('the floor is calibrated for models with a high baseline', () => {
    // Measured with granite-embedding-small: unrelated text sits around 0.65,
    // a near-paraphrase around 0.89. A 0.6 floor would call unrelated text related.
    const a = blip('a', 'first')
    const b = blip('b', 'second')
    const unrelated = new Map([
      ['a', [1, 0]],
      ['b', [0.65, Math.sqrt(1 - 0.65 * 0.65)]],
    ])
    expect(relatedness(a, b, { embeddings: unrelated }).score).toBe(0)

    const paraphrase = new Map([
      ['a', [1, 0]],
      ['b', [0.89, Math.sqrt(1 - 0.89 * 0.89)]],
    ])
    expect(relatedness(a, b, { embeddings: paraphrase }).score).toBeGreaterThan(0)
  })

  test('the floor can be tuned for a model with a different baseline', () => {
    const a = blip('a', 'first')
    const b = blip('b', 'second')
    const embeddings = new Map([
      ['a', [1, 0]],
      ['b', [0.65, Math.sqrt(1 - 0.65 * 0.65)]],
    ])
    expect(relatedness(a, b, { embeddings }).score).toBe(0)
    expect(relatedness(a, b, { embeddings, similarityFloor: 0.6 }).score).toBeGreaterThan(0)
  })
})

describe('topRelated', () => {
  const a = blip('a', 'stages of change theory', 'idea', ['change'])
  const b = blip('b', 'interventions by stage', 'idea', ['change'])
  const c = blip('c', 'drawing practice', 'quest', ['drawing'])
  const d = blip('d', 'harmony singing', 'yearning', ['singing'])

  test('ranks the related above the unrelated and excludes the blip itself', () => {
    const related = topRelated(a, [a, b, c, d])
    expect(related[0]?.blip.id).toBe('b')
    expect(related.map((entry) => entry.blip.id)).not.toContain('a')
  })

  test('drops everything below the threshold', () => {
    const related = topRelated(a, [a, c, d])
    expect(related).toHaveLength(0)
  })

  test('respects the limit', () => {
    expect(topRelated(a, [a, b, c, d], { limit: 1 })).toHaveLength(1)
  })

  test('skips blips already linked unless asked for them', () => {
    const linkedA = linked(a, b)
    const withoutLinked = topRelated(linkedA, [linkedA, b, c])
    expect(withoutLinked.map((entry) => entry.blip.id)).not.toContain('b')

    const withLinked = topRelated(linkedA, [linkedA, b, c], { includeLinked: true })
    expect(withLinked.map((entry) => entry.blip.id)).toContain('b')
  })

  test('ignores deleted blips', () => {
    const [deleted] = project([
      ev(
        {
          t: 'captured',
          id: 'b',
          input: { kind: 'text', text: 'interventions by stage' },
          type: 'idea',
          topics: ['change'],
        },
        '2026-01-01T00:00:00Z',
      ),
      ev({ t: 'deleted', id: 'b' }, '2026-01-01T00:00:01Z'),
    ])
    if (!deleted) throw new Error('expected a blip')
    expect(topRelated(a, [a, deleted])).toHaveLength(0)
  })

  test('is deterministic for equal scores', () => {
    const first = blip('x1', 'change theory', 'idea', ['change'])
    const second = blip('x2', 'change theory', 'idea', ['change'])
    const once = topRelated(a, [a, first, second]).map((entry) => entry.blip.id)
    const twice = topRelated(a, [a, second, first]).map((entry) => entry.blip.id)
    expect(once).toEqual(twice)
  })
})

describe('blipText', () => {
  test('gathers title, body, topics and entries', () => {
    const text = blipText(blip('a', 'a title', 'idea', ['a-topic']))
    expect(text).toContain('a title')
    expect(text).toContain('a-topic')
  })
})
