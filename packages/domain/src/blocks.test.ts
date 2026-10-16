import { describe, expect, test } from 'bun:test'
import {
  BLOCK_KINDS,
  blockKindInfo,
  blockSummary,
  checklistCounts,
  newBlock,
  newItem,
  pollLeader,
  progressFraction,
  withItemAdded,
  withItemRemoved,
  withItemText,
  withProgress,
  withToggledItem,
  withTotal,
  withVote,
} from './blocks'
import type { BlipEvent } from './events'
import { project } from './project'

describe('blocks — building them', () => {
  test('a new block starts with one row, so there is something to type into', () => {
    for (const info of BLOCK_KINDS) {
      const block = newBlock(info.kind)
      expect(block.kind).toBe(info.kind)
      if (info.kind === 'readingProgress') {
        // A tracker is not a list; it starts at zero of zero.
        expect(block.items).toHaveLength(0)
        expect(block.progress).toEqual({ current: 0, total: 0 })
      } else {
        expect(block.items).toHaveLength(1)
      }
    }
  })

  test('every kind has a label and a hint that says what it is for', () => {
    for (const info of BLOCK_KINDS) {
      expect(info.label.length).toBeGreaterThan(0)
      expect(info.hint.length).toBeGreaterThan(10)
      expect(info.itemNoun.length).toBeGreaterThan(0)
    }
  })
})

describe('blocks — checklists', () => {
  test('ticking a row flips only that row', () => {
    const a = newItem('one')
    const b = newItem('two')
    const after = withToggledItem([a, b], a.id)
    expect(after[0]?.done).toBe(true)
    expect(after[1]?.done).toBeUndefined()
  })

  test('ticking twice unticks', () => {
    const a = newItem('one')
    const once = withToggledItem([a], a.id)
    expect(withToggledItem(once, a.id)[0]?.done).toBe(false)
  })

  test('counts ignore blank rows, so an empty new row does not inflate the total', () => {
    const rows = [newItem('one'), newItem('   '), newItem('two')]
    expect(checklistCounts({ id: 'b', kind: 'checklist', items: rows })).toEqual({
      done: 0,
      total: 2,
    })
  })

  test('an all-blank checklist has no count at all', () => {
    const rows = [newItem(''), newItem()]
    expect(checklistCounts({ id: 'b', kind: 'checklist', items: rows })).toBeNull()
  })

  test('editing and removing a row work by id', () => {
    const a = newItem('one')
    const b = newItem('two')
    expect(withItemText([a, b], a.id, 'changed')[0]?.text).toBe('changed')
    expect(withItemRemoved([a, b], a.id).map((item) => item.text)).toEqual(['two'])
    expect(withItemAdded([a], 'three')).toHaveLength(2)
  })
})

describe('blocks — reading progress', () => {
  test('a tracker with no length has no fraction, rather than dividing by zero', () => {
    expect(progressFraction({ id: 'b', kind: 'readingProgress', items: [] })).toBeNull()
    expect(
      progressFraction({
        id: 'b',
        kind: 'readingProgress',
        items: [],
        progress: { current: 0, total: 0 },
      }),
    ).toBeNull()
  })

  test('the fraction is current over total', () => {
    const block = {
      id: 'b',
      kind: 'readingProgress' as const,
      items: [],
      progress: { current: 30, total: 120 },
    }
    expect(progressFraction(block)).toBeCloseTo(0.25)
  })

  test('moving past the end stops at the end', () => {
    const block = {
      id: 'b',
      kind: 'readingProgress' as const,
      items: [],
      progress: { current: 0, total: 120 },
    }
    expect(withProgress(block, 500)).toEqual({ current: 120, total: 120 })
    expect(withProgress(block, -20)).toEqual({ current: 0, total: 120 })
  })

  test('shrinking the total pulls the current position back with it', () => {
    const block = {
      id: 'b',
      kind: 'readingProgress' as const,
      items: [],
      progress: { current: 100, total: 120 },
    }
    expect(withTotal(block, 40)).toEqual({ current: 40, total: 40 })
  })
})

describe('blocks — polls', () => {
  test('votes accumulate per option', () => {
    const a = newItem('A')
    const b = newItem('B')
    const voted = withVote(withVote([a, b], a.id), a.id)
    expect(voted[0]?.votes).toBe(2)
    expect(voted[1]?.votes).toBeUndefined()
  })

  test('the leader is the option with the most votes', () => {
    const rows = [
      { id: '1', text: 'A', votes: 1 },
      { id: '2', text: 'B', votes: 3 },
    ]
    expect(pollLeader({ id: 'b', kind: 'poll', items: rows })?.text).toBe('B')
  })

  test('a tie has no leader, and neither does a poll nobody has voted in', () => {
    const tied = [
      { id: '1', text: 'A', votes: 2 },
      { id: '2', text: 'B', votes: 2 },
    ]
    expect(pollLeader({ id: 'b', kind: 'poll', items: tied })).toBeNull()

    const unvoted = [
      { id: '1', text: 'A' },
      { id: '2', text: 'B' },
    ]
    expect(pollLeader({ id: 'b', kind: 'poll', items: unvoted })).toBeNull()
  })
})

describe('blocks — summaries', () => {
  test('each kind says something useful when collapsed', () => {
    const checklist = { id: 'b', kind: 'checklist' as const, items: [newItem('one')] }
    expect(blockSummary(checklist)).toBe('0 of 1 done')

    expect(blockSummary({ id: 'b', kind: 'readingProgress', items: [] })).toBe('no length set')
    expect(
      blockSummary({
        id: 'b',
        kind: 'readingProgress',
        items: [],
        progress: { current: 1, total: 4 },
      }),
    ).toBe('1 of 4 · 25%')

    expect(blockSummary({ id: 'b', kind: 'poll', items: [newItem('A')] })).toBe('no votes yet')
    expect(blockSummary({ id: 'b', kind: 'grid', items: [newItem()] })).toBe('no images yet')
  })
})

describe('blocks — folding', () => {
  const meta = (seq: number): { deviceId: string; seq: number; at: string } => ({
    deviceId: 'dev-a',
    seq,
    at: `2026-03-01T00:00:0${seq}Z`,
  })

  test('a block survives being added, changed and folded', () => {
    const block = newBlock('checklist', 'Three sessions')
    const item = block.items[0]
    if (!item) throw new Error('expected a starting row')

    const events: BlipEvent[] = [
      {
        ...meta(0),
        t: 'captured',
        id: 'x',
        input: { kind: 'text', text: 'a quest' },
        type: 'quest',
      },
      { ...meta(1), t: 'blockAdded', id: 'x', block },
      { ...meta(2), t: 'blockUpdated', id: 'x', blockId: block.id, patch: { title: 'Renamed' } },
    ]
    const [blip] = project(events)
    expect(blip?.blocks).toHaveLength(1)
    expect(blip?.blocks[0]?.title).toBe('Renamed')
    expect(blip?.blocks[0]?.items).toHaveLength(1)
  })

  test('removing a block is a tombstone, and the rest survive', () => {
    const keep = newBlock('checklist', 'keep')
    const drop = newBlock('poll', 'drop')
    const events: BlipEvent[] = [
      {
        ...meta(0),
        t: 'captured',
        id: 'x',
        input: { kind: 'text', text: 'a quest' },
        type: 'quest',
      },
      { ...meta(1), t: 'blockAdded', id: 'x', block: keep },
      { ...meta(2), t: 'blockAdded', id: 'x', block: drop },
      { ...meta(3), t: 'blockRemoved', id: 'x', blockId: drop.id },
    ]
    const [blip] = project(events)
    expect(blip?.blocks.map((b) => b.title)).toEqual(['keep'])
  })

  test('fold order does not matter for blocks', () => {
    const block = newBlock('checklist', 'one')
    const events: BlipEvent[] = [
      {
        ...meta(0),
        t: 'captured',
        id: 'x',
        input: { kind: 'text', text: 'a quest' },
        type: 'quest',
      },
      { ...meta(1), t: 'blockAdded', id: 'x', block },
      { ...meta(2), t: 'blockUpdated', id: 'x', blockId: block.id, patch: { title: 'two' } },
    ]
    const forwards = project(events)
    const backwards = project([...events].reverse())
    expect(forwards[0]?.blocks[0]?.title).toBe(backwards[0]?.blocks[0]?.title)
  })
})

describe('what counts as structure', () => {
  test('a checklist and a grid, which are shapes for what you already have', () => {
    // Parts to tick off, and variations side by side. Both arrange something; neither is
    // about one specific thing.
    const offered = BLOCK_KINDS.filter((info) => info.structure).map((info) => info.kind)
    expect(offered).toEqual(['checklist', 'grid'])
  })

  test('reading progress and a poll are about one thing, so they are not', () => {
    // How far through a page you are, and which of these you prefer. Neither is a shape
    // anybody reaches for mid-sentence, which is when this is offered.
    const notOffered = BLOCK_KINDS.filter((info) => !info.structure).map((info) => info.kind)
    expect(notOffered).toEqual(['readingProgress', 'poll'])
  })

  test('they still render, and an Inkling that already has one keeps it', () => {
    // Hidden from the picker is not the same as removed: the kinds, their labels and their
    // behaviour are all still here.
    for (const kind of ['readingProgress', 'poll'] as const) {
      const info = blockKindInfo(kind)
      expect(info?.label).toBeTruthy()
      expect(info?.itemNoun).toBeTruthy()
    }
  })
})
