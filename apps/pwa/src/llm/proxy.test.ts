import { afterEach, describe, expect, test } from 'bun:test'
import { ProxyProvider } from './proxy'

const realFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = realFetch
})

function stubFetch(handler: () => Promise<Response>): { calls: () => number } {
  let calls = 0
  globalThis.fetch = (async () => {
    calls += 1
    return handler()
  }) as unknown as typeof fetch
  return { calls: () => calls }
}

describe('ProxyProvider.available', () => {
  test('caches a positive answer, so a move selection is not a probe each time', async () => {
    const stub = stubFetch(async () => Response.json({ configured: true }))
    const provider = new ProxyProvider('/api')
    expect(await provider.available()).toBe(true)
    expect(await provider.available()).toBe(true)
    expect(stub.calls()).toBe(1)
  })

  test('does not cache a network failure', async () => {
    let reachable = false
    const stub = stubFetch(async () => {
      if (!reachable) throw new Error('network down')
      return Response.json({ configured: true })
    })

    const provider = new ProxyProvider('/api')
    expect(await provider.available()).toBe(false)

    // The server comes back. A cached negative would disable the model for the
    // rest of the session; the provider must ask again.
    reachable = true
    expect(await provider.available()).toBe(true)
    expect(stub.calls()).toBe(2)
  })

  test('does not cache an unconfigured server either, so adding a key needs no reload', async () => {
    let configured = false
    const stub = stubFetch(async () => Response.json({ configured }))

    const provider = new ProxyProvider('/api')
    expect(await provider.available()).toBe(false)
    configured = true
    expect(await provider.available()).toBe(true)
    expect(stub.calls()).toBe(2)
  })

  test('treats a non-ok response as unavailable rather than throwing', async () => {
    stubFetch(async () => new Response('nope', { status: 500 }))
    const provider = new ProxyProvider('/api')
    expect(await provider.available()).toBe(false)
  })
})

describe('ProxyProvider.completeStructured', () => {
  test('returns the model text', async () => {
    stubFetch(async () => Response.json({ text: '{"id":"any.react"}' }))
    const provider = new ProxyProvider('/api')
    expect(await provider.completeStructured({ system: 's', prompt: 'p' })).toBe(
      '{"id":"any.react"}',
    )
  })

  test('throws on a failed completion, so the caller falls back to the playbook', async () => {
    stubFetch(async () => new Response('upstream exploded', { status: 502 }))
    const provider = new ProxyProvider('/api')
    await expect(provider.completeStructured({ system: 's', prompt: 'p' })).rejects.toThrow()
  })

  test('throws when the server returns no text', async () => {
    stubFetch(async () => Response.json({}))
    const provider = new ProxyProvider('/api')
    await expect(provider.completeStructured({ system: 's', prompt: 'p' })).rejects.toThrow()
  })
})
