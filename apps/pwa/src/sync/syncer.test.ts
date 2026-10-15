import { describe, expect, test } from 'bun:test'
import type { BlipEvent } from '@inkling/domain'
import { mimeFor, referencedHashes } from './syncer'

/**
 * Which blobs a log refers to.
 *
 * This decides what actually crosses the wire, so a gap here is silent data loss: the
 * event syncs, the image never arrives, and the other device shows a placeholder
 * forever. Blocks were exactly that gap before they were added here.
 */

const meta = { deviceId: 'dev-a', seq: 1, at: '2026-03-01T00:00:00Z' }

describe('referencedHashes', () => {
  test('a captured image is referenced', () => {
    const events: BlipEvent[] = [
      {
        ...meta,
        t: 'captured',
        id: 'x',
        input: { kind: 'image', mediaId: 'hash-capture', mime: 'image/png' },
        type: 'reference',
      },
    ]
    expect([...referencedHashes(events)]).toEqual(['hash-capture'])
  })

  test('an image on an entry is referenced', () => {
    const events: BlipEvent[] = [
      {
        ...meta,
        t: 'entry',
        id: 'x',
        entry: { id: 'e', at: meta.at, kind: 'media', mediaId: 'hash-entry' },
      },
    ]
    expect([...referencedHashes(events)]).toEqual(['hash-entry'])
  })

  test('an image inside a grid block is referenced — this was the gap', () => {
    const events: BlipEvent[] = [
      {
        ...meta,
        t: 'blockAdded',
        id: 'x',
        block: {
          id: 'b',
          kind: 'grid',
          items: [
            { id: '1', mediaId: 'hash-grid-a', mime: 'image/png' },
            { id: '2', text: 'a caption with no image' },
            { id: '3', mediaId: 'hash-grid-b', mime: 'image/jpeg' },
          ],
        },
      },
    ]
    expect(referencedHashes(events).size).toBe(2)
    expect(referencedHashes(events).has('hash-grid-a')).toBe(true)
    expect(referencedHashes(events).has('hash-grid-b')).toBe(true)
  })

  test('an image added by updating a block is referenced', () => {
    const events: BlipEvent[] = [
      {
        ...meta,
        t: 'blockUpdated',
        id: 'x',
        blockId: 'b',
        patch: { items: [{ id: '1', mediaId: 'hash-later', mime: 'image/webp' }] },
      },
    ]
    expect(referencedHashes(events).has('hash-later')).toBe(true)
  })

  test('a block with no images references nothing', () => {
    const events: BlipEvent[] = [
      {
        ...meta,
        t: 'blockAdded',
        id: 'x',
        block: { id: 'b', kind: 'checklist', items: [{ id: '1', text: 'a step' }] },
      },
    ]
    expect(referencedHashes(events).size).toBe(0)
  })

  test('an empty mediaId is not treated as a hash', () => {
    const events: BlipEvent[] = [
      {
        ...meta,
        t: 'blockAdded',
        id: 'x',
        block: { id: 'b', kind: 'grid', items: [{ id: '1', mediaId: '' }] },
      },
    ]
    expect(referencedHashes(events).size).toBe(0)
  })
})

describe('mimeFor', () => {
  test('a grid image keeps the mime it was stored as', () => {
    const events: BlipEvent[] = [
      {
        ...meta,
        t: 'blockAdded',
        id: 'x',
        block: { id: 'b', kind: 'grid', items: [{ id: '1', mediaId: 'h', mime: 'image/jpeg' }] },
      },
    ]
    expect(mimeFor(events, 'h')).toBe('image/jpeg')
  })

  test('a capture mime is still found first', () => {
    const events: BlipEvent[] = [
      {
        ...meta,
        t: 'captured',
        id: 'x',
        input: { kind: 'image', mediaId: 'h', mime: 'image/png' },
        type: 'reference',
      },
    ]
    expect(mimeFor(events, 'h')).toBe('image/png')
  })

  test('an unknown hash falls back rather than throwing', () => {
    expect(mimeFor([], 'nope')).toBe('application/octet-stream')
  })
})
