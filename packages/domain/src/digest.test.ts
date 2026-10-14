import { describe, expect, test } from 'bun:test'
import type { BlipEvent, BlipEventBody } from '../src/index'
import { stateDigest } from '../src/index'

function ev(body: BlipEventBody, seq: number, at: string, deviceId: string): BlipEvent {
  return { ...body, deviceId, seq, at }
}

function captured(id: string, text: string, seq: number, deviceId: string): BlipEvent {
  return ev(
    { t: 'captured', id, input: { kind: 'text', text }, type: 'idea' },
    seq,
    `2026-01-01T00:00:0${seq}Z`,
    deviceId,
  )
}

describe('stateDigest', () => {
  test('does not depend on the order events were learned', async () => {
    const events = [
      captured('a', 'from the phone', 0, 'phone'),
      captured('b', 'from the laptop', 0, 'laptop'),
      ev({ t: 'promoteToDesktop', id: 'a' }, 1, '2026-01-01T00:00:05Z', 'phone'),
    ]
    expect(await stateDigest(events)).toBe(await stateDigest([...events].reverse()))
  })

  test('changes when the folded state changes', async () => {
    const base = [captured('a', 'a thought', 0, 'phone')]
    const withRetire = [...base, ev({ t: 'retired', id: 'a' }, 1, '2026-01-01T00:00:02Z', 'phone')]
    expect(await stateDigest(base)).not.toBe(await stateDigest(withRetire))
  })

  test('is a 64-character hex digest', async () => {
    expect(await stateDigest([captured('a', 'x', 0, 'phone')])).toMatch(/^[a-f0-9]{64}$/)
  })

  test('two devices that have seen the same events agree', async () => {
    const phone = [captured('a', 'a thought', 0, 'phone')]
    const laptop = [captured('b', 'another', 0, 'laptop')]
    const phoneKnowsEverything = [...phone, ...laptop]
    const laptopKnowsEverything = [...laptop, ...phone]
    expect(await stateDigest(phoneKnowsEverything)).toBe(await stateDigest(laptopKnowsEverything))
  })
})
