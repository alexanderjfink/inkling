import { describe, expect, test } from 'bun:test'
import type { BlipEvent } from '@inkling/domain'
import { newBlock, project, withToggledItem } from '@inkling/domain'
import { daysSince, renderMarkdownBackup } from './backup'

/**
 * The escape hatch has to be readable without this app.
 *
 * If it only round-trips through Inkling, it is not a backup — it is another copy of
 * the problem. These check it is the kind of file you could open in ten years.
 */

const meta = (seq: number) => ({
  deviceId: 'dev-a',
  seq,
  at: `2026-03-0${seq}T00:00:00Z`,
})

function build(events: BlipEvent[]) {
  return project(events)
}

describe('renderMarkdownBackup', () => {
  test('names the file with the date and counts what is in it', () => {
    const blips = build([
      { ...meta(1), t: 'captured', id: 'a', input: { kind: 'text', text: 'one' }, type: 'idea' },
      { ...meta(2), t: 'captured', id: 'b', input: { kind: 'text', text: 'two' }, type: 'idea' },
    ])
    const md = renderMarkdownBackup(blips, new Date('2026-10-15T12:00:00Z'))
    expect(md).toContain('# Inkling backup — 2026-10-15')
    expect(md).toContain('2 Inklings')
  })

  test('a deleted Inkling is left out', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'keep me' },
        type: 'idea',
      },
      {
        ...meta(2),
        t: 'captured',
        id: 'b',
        input: { kind: 'text', text: 'drop me' },
        type: 'idea',
      },
      { ...meta(3), t: 'deleted', id: 'b' },
    ])
    const md = renderMarkdownBackup(blips)
    expect(md).toContain('keep me')
    expect(md).not.toContain('drop me')
  })

  test('entries, urls and topics all survive', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'url', url: 'https://drawabox.com/' },
        type: 'reference',
        body: 'learn to draw',
        topics: ['draw', 'drawabox'],
      },
      {
        ...meta(2),
        t: 'entry',
        id: 'a',
        entry: { id: 'e1', at: meta(2).at, kind: 'note', text: 'the 50% rule matters' },
      },
    ])
    const md = renderMarkdownBackup(blips)
    expect(md).toContain('<https://drawabox.com/>')
    expect(md).toContain('#draw')
    expect(md).toContain('the 50% rule matters')
  })

  test('a checklist keeps which items are ticked', () => {
    const block = newBlock('checklist', 'Three sessions')
    // newBlock leaves one empty row to type into, so give it something to tick.
    const first = { ...(block.items[0] ?? { id: 'x' }), text: 'first 30 minutes' }
    const ticked = { ...block, items: withToggledItem([first], first.id) }
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'a quest' },
        type: 'quest',
      },
      { ...meta(2), t: 'blockAdded', id: 'a', block: ticked },
    ])
    const md = renderMarkdownBackup(blips)
    expect(md).toContain('### Three sessions')
    expect(md).toContain('- [x] first 30 minutes')
  })

  test('an unticked row exports as unticked', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'a quest' },
        type: 'quest',
      },
      {
        ...meta(2),
        t: 'blockAdded',
        id: 'a',
        block: { id: 'blk', kind: 'checklist', items: [{ id: '1', text: 'not yet', done: false }] },
      },
    ])
    expect(renderMarkdownBackup(blips)).toContain('- [ ] not yet')
  })

  test('a reading tracker exports its position', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'url', url: 'https://x.test' },
        type: 'reference',
      },
      {
        ...meta(2),
        t: 'blockAdded',
        id: 'a',
        block: {
          id: 'blk',
          kind: 'readingProgress',
          title: 'Lesson 1',
          items: [],
          progress: { current: 42, total: 120 },
        },
      },
    ])
    expect(renderMarkdownBackup(blips)).toContain('42 of 120')
  })

  test('a poll exports its votes', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'which?' },
        type: 'question',
      },
      {
        ...meta(2),
        t: 'blockAdded',
        id: 'a',
        block: { id: 'blk', kind: 'poll', items: [{ id: '1', text: 'A', votes: 2 }] },
      },
    ])
    expect(renderMarkdownBackup(blips)).toContain('A — 2 vote(s)')
  })

  test('moves that were done are recorded with their date', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'a quest' },
        type: 'quest',
      },
      // Shown before done, as it must be: a move cannot be finished before it is offered.
      {
        ...meta(2),
        t: 'moveShown',
        id: 'a',
        moveId: 'm1',
        moveSpec: {
          id: 'm1',
          title: 'Break it into three sessions',
          why: 'so the first one is small',
          timeLimitSec: 300,
          goal: 'three sessions',
          playbook: 'quest.break',
          generatedBy: 'playbook',
        },
      },
      { ...meta(3), t: 'moveDone', id: 'a', moveId: 'm1' },
    ])
    const md = renderMarkdownBackup(blips)
    expect(md).toContain('Break it into three sessions')
    expect(md).toContain('2026-03-03')
  })

  test('a move only shown, never done, is not listed as done', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'a quest' },
        type: 'quest',
      },
      {
        ...meta(2),
        t: 'moveShown',
        id: 'a',
        moveId: 'm1',
        moveSpec: {
          id: 'm1',
          title: 'Not done yet',
          why: 'because',
          timeLimitSec: 300,
          goal: 'something',
          playbook: 'quest.break',
          generatedBy: 'playbook',
        },
      },
    ])
    expect(renderMarkdownBackup(blips)).not.toContain('Not done yet')
  })

  test('a promoted Inkling records where the note went', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'an idea' },
        type: 'idea',
      },
      { ...meta(2), t: 'promoted', id: 'a', notePath: '00 Seedbox/An idea.md' },
    ])
    expect(renderMarkdownBackup(blips)).toContain('Promoted to: 00 Seedbox/An idea.md')
  })

  test('an empty log renders a valid, empty document rather than throwing', () => {
    const md = renderMarkdownBackup([])
    expect(md).toContain('# Inkling backup')
    expect(md).toContain('0 Inklings')
  })

  test('a title edited down to nothing exports as (untitled), not as an id', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'something' },
        type: 'idea',
      },
      { ...meta(2), t: 'edited', id: 'a', title: '' },
    ])
    expect(renderMarkdownBackup(blips)).toContain('## (untitled)')
  })

  test('a capture with nothing in it falls back to its id, matching what the app shows', () => {
    // The projection's own last resort. An empty heading would look like a bug, and the
    // export must not disagree with the card.
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'abcdef1234',
        input: { kind: 'text', text: '' },
        type: 'idea',
      },
    ])
    expect(renderMarkdownBackup(blips)).toContain('## abcdef12')
  })
  test('an image-only Inkling says the image is not in the file', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'image', mediaId: 'h' },
        type: 'reference',
      },
      {
        ...meta(2),
        t: 'blockAdded',
        id: 'a',
        block: { id: 'blk', kind: 'grid', items: [{ id: '1', mediaId: 'h', mime: 'image/png' }] },
      },
    ])
    const md = renderMarkdownBackup(blips)
    expect(md).toContain('not included here')
  })

  test('the context an entry was written in is kept, marked as not your own words', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'learn to draw' },
        type: 'quest',
      },
      {
        ...meta(2),
        t: 'moveShown',
        id: 'a',
        moveId: 'm1',
        moveSpec: {
          id: 'm1',
          title: 'Read one paragraph and keep one sentence',
          why: 'so it sticks',
          timeLimitSec: 300,
          goal: 'one sentence you would repeat to someone else',
          playbook: 'reference.deepRead',
          generatedBy: 'playbook',
        },
      },
      {
        ...meta(3),
        t: 'entry',
        id: 'a',
        moveId: 'm1',
        entry: {
          id: 'e1',
          kind: 'note',
          text: 'the 50% rule matters',
          at: meta(3).at,
          context: {
            guidance: ['check how the rule is phrased'],
            material: { title: 'Drawabox', url: 'https://drawabox.com/', extract: 'The 50% rule…' },
          },
        },
      },
    ])
    const md = renderMarkdownBackup(blips)
    expect(md).toContain('the 50% rule matters')
    // Blockquoted, because it surrounded the entry rather than being written by hand.
    expect(md).toContain('> *prompted by:* Read one paragraph and keep one sentence')
    expect(md).toContain('> - check how the rule is phrased')
    expect(md).toContain('> *found:* Drawabox <https://drawabox.com/>')
  })

  test('an entry with no context gets no blockquote', () => {
    const blips = build([
      {
        ...meta(1),
        t: 'captured',
        id: 'a',
        input: { kind: 'text', text: 'a thought' },
        type: 'idea',
      },
      {
        ...meta(2),
        t: 'entry',
        id: 'a',
        entry: { id: 'e1', kind: 'note', text: 'just this', at: meta(2).at },
      },
    ])
    expect(renderMarkdownBackup(blips)).not.toContain('>')
  })
})

describe('daysSince', () => {
  test('counts whole days', () => {
    const now = new Date('2026-10-15T12:00:00Z')
    expect(daysSince(new Date('2026-10-15T09:00:00Z'), now)).toBe(0)
    expect(daysSince(new Date('2026-10-08T12:00:00Z'), now)).toBe(7)
  })

  test('never having backed up is null, not zero', () => {
    // The difference matters: zero would read as "just backed up".
    expect(daysSince(null)).toBeNull()
  })
})
