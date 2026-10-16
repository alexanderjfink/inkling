import { describe, expect, test } from 'bun:test'
import type { BlipEvent, MoveSpec } from './events'
import { CONTEXT_EXTRACT_LIMIT, entryContext, hasContext } from './events'
import { project } from './project'

/**
 * The context an entry was written in.
 *
 * The prompt is part of the answer, and the guidance and material exist nowhere else in
 * the log — they were fetched and shown once. These check they are kept, trimmed, and
 * still reachable after a fold.
 */

const meta = (seq: number) => ({
  deviceId: 'dev-a',
  seq,
  at: `2026-03-0${seq}T00:00:00Z`,
})

const MOVE: MoveSpec = {
  id: 'm1',
  title: 'Read one paragraph and keep one sentence',
  why: 'so it sticks',
  timeLimitSec: 300,
  goal: 'one sentence you would repeat to someone else',
  playbook: 'reference.deepRead',
  generatedBy: 'playbook',
}

describe('entryContext', () => {
  test('nothing to say means nothing is stored', () => {
    expect(entryContext({})).toBeUndefined()
    expect(entryContext({ guidance: [] })).toBeUndefined()
    expect(entryContext({ guidance: ['  ', ''] })).toBeUndefined()
    expect(entryContext({ material: null })).toBeUndefined()
  })

  test('guidance is kept', () => {
    expect(entryContext({ guidance: ['check the date', 'note the phrasing'] })).toEqual({
      guidance: ['check the date', 'note the phrasing'],
    })
  })

  test('blank guidance is dropped rather than stored as an empty bullet', () => {
    expect(entryContext({ guidance: ['keep this', '   '] })?.guidance).toEqual(['keep this'])
  })

  test('material is kept with its link and extract', () => {
    const context = entryContext({
      material: {
        title: 'A Drawing Course',
        url: 'https://example.com/drawing-course',
        extract: 'The 50% rule…',
      },
    })
    expect(context?.material).toEqual({
      title: 'A Drawing Course',
      url: 'https://example.com/drawing-course',
      extract: 'The 50% rule…',
    })
  })

  test('a very long extract is trimmed, so the log does not carry a whole article', () => {
    const extract = 'x'.repeat(5000)
    const stored = entryContext({ material: { title: 't', url: 'u', extract } })?.material?.extract
    expect(stored?.length).toBeLessThanOrEqual(CONTEXT_EXTRACT_LIMIT)
    expect(stored?.endsWith('…')).toBe(true)
  })

  test('an extract exactly at the limit is left alone', () => {
    const extract = 'x'.repeat(CONTEXT_EXTRACT_LIMIT)
    expect(entryContext({ material: { title: 't', url: 'u', extract } })?.material?.extract).toBe(
      extract,
    )
  })

  test('a material with no title or url is not stored', () => {
    expect(entryContext({ material: { title: '', url: '', extract: 'orphan' } })).toBeUndefined()
  })

  test('both at once', () => {
    const context = entryContext({
      material: { title: 't', url: 'u', extract: 'e' },
      guidance: ['one'],
    })
    expect(context?.material).toBeDefined()
    expect(context?.guidance).toEqual(['one'])
  })
})

describe('hasContext', () => {
  test('false for a plain entry, and for an empty context', () => {
    expect(hasContext({ id: 'e', kind: 'note', at: meta(1).at })).toBe(false)
    expect(hasContext({ id: 'e', kind: 'note', at: meta(1).at, context: {} })).toBe(false)
  })

  test('true when there is material or guidance', () => {
    expect(
      hasContext({ id: 'e', kind: 'note', at: meta(1).at, context: { guidance: ['a'] } }),
    ).toBe(true)
    expect(
      hasContext({
        id: 'e',
        kind: 'note',
        at: meta(1).at,
        context: { material: { title: 't', url: '', extract: '' } },
      }),
    ).toBe(true)
  })
})

describe('folding the link back to the move', () => {
  test('an entry keeps the move that prompted it', () => {
    // The moveId lives on the event; without copying it onto the entry, the projection
    // loses the link and an entry can never be traced back to what asked for it.
    const events: BlipEvent[] = [
      { ...meta(1), t: 'captured', id: 'x', input: { kind: 'text', text: 'draw' }, type: 'quest' },
      { ...meta(2), t: 'moveShown', id: 'x', moveId: 'm1', moveSpec: MOVE },
      {
        ...meta(3),
        t: 'entry',
        id: 'x',
        moveId: 'm1',
        entry: {
          id: 'e1',
          kind: 'note',
          text: 'the 50% rule matters',
          at: meta(3).at,
          context: { guidance: ['check how the rule is phrased'] },
        },
      },
    ]
    const [blip] = project(events)
    const entry = blip?.entries[0]
    expect(entry?.moveId).toBe('m1')
    expect(entry?.context?.guidance).toEqual(['check how the rule is phrased'])
    expect(blip?.moves.find((record) => record.moveId === entry?.moveId)?.spec.title).toBe(
      MOVE.title,
    )
  })

  test('a free-form entry has no move and is not given one', () => {
    const events: BlipEvent[] = [
      { ...meta(1), t: 'captured', id: 'x', input: { kind: 'text', text: 'draw' }, type: 'quest' },
      {
        ...meta(2),
        t: 'entry',
        id: 'x',
        entry: { id: 'e1', kind: 'note', text: 'a thought', at: meta(2).at },
      },
    ]
    const [blip] = project(events)
    expect(blip?.entries[0]?.moveId).toBeUndefined()
    expect(blip?.entries[0]?.context).toBeUndefined()
  })

  test('the context survives a round trip through JSON, as the log does', () => {
    const events: BlipEvent[] = [
      { ...meta(1), t: 'captured', id: 'x', input: { kind: 'text', text: 'draw' }, type: 'quest' },
      {
        ...meta(2),
        t: 'entry',
        id: 'x',
        moveId: 'm1',
        entry: {
          id: 'e1',
          kind: 'note',
          text: 'kept',
          at: meta(2).at,
          context: {
            material: {
              title: 'A Drawing Course',
              url: 'https://example.com/drawing-course',
              extract: 'e',
            },
            guidance: ['one', 'two'],
          },
        },
      },
    ]
    const wire = events.map((event) => JSON.stringify(event)).join('\n')
    const back = wire.split('\n').map((line) => JSON.parse(line) as BlipEvent)
    const [blip] = project(back)
    expect(blip?.entries[0]?.context).toEqual({
      material: {
        title: 'A Drawing Course',
        url: 'https://example.com/drawing-course',
        extract: 'e',
      },
      guidance: ['one', 'two'],
    })
  })
})
