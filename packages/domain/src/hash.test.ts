import { describe, expect, test } from 'bun:test'
import { sha256Hex } from '../src/index'

describe('sha256Hex', () => {
  test('matches the known digest of the empty input', async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
  })

  test('is stable for identical bytes and differs for different bytes', async () => {
    const a = new TextEncoder().encode('a photo of a blip')
    const b = new TextEncoder().encode('a photo of a blip')
    const c = new TextEncoder().encode('a different photo')
    expect(await sha256Hex(a)).toBe(await sha256Hex(b))
    expect(await sha256Hex(a)).not.toBe(await sha256Hex(c))
  })

  test('produces 64 lowercase hex characters', async () => {
    expect(await sha256Hex(new TextEncoder().encode('x'))).toMatch(/^[a-f0-9]{64}$/)
  })
})
