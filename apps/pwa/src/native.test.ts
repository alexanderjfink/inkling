import { describe, expect, test } from 'bun:test'
import { defaultServerUrl, isNative, needsServerUrl } from './native'

/**
 * The native shell is the one case where a relative `/api` is wrong.
 *
 * In a browser, opening the server's own address means same-origin and no setup at
 * all. In an APK the app is served from the device, so `/api` would point at the
 * device — a failure that looks like "the server is down" rather than a config error.
 */

function withWindow(value: unknown, run: () => void) {
  const original = (globalThis as { window?: unknown }).window
  ;(globalThis as { window?: unknown }).window = value
  try {
    run()
  } finally {
    if (original === undefined) delete (globalThis as { window?: unknown }).window
    else (globalThis as { window?: unknown }).window = original
  }
}

describe('isNative', () => {
  test('false with no window at all, rather than throwing', () => {
    const original = (globalThis as { window?: unknown }).window
    delete (globalThis as { window?: unknown }).window
    try {
      expect(isNative()).toBe(false)
    } finally {
      ;(globalThis as { window?: unknown }).window = original
    }
  })

  test('false in a plain browser', () => {
    withWindow({}, () => expect(isNative()).toBe(false))
  })

  test('true when Capacitor says so', () => {
    withWindow({ Capacitor: { isNativePlatform: () => true } }, () => expect(isNative()).toBe(true))
  })

  test('false when Capacitor is present but not native — it is on the web too', () => {
    withWindow({ Capacitor: { isNativePlatform: () => false } }, () =>
      expect(isNative()).toBe(false),
    )
  })

  test('a broken Capacitor global does not break the app', () => {
    withWindow(
      {
        Capacitor: {
          isNativePlatform: () => {
            throw new Error('nope')
          },
        },
      },
      () => expect(isNative()).toBe(false),
    )
  })
})

describe('defaultServerUrl', () => {
  test('same origin when nothing was baked in, which is the whole point', () => {
    expect(defaultServerUrl()).toBe('/api')
  })
})

describe('needsServerUrl', () => {
  test('a relative path is fine in a browser', () => {
    withWindow({}, () => expect(needsServerUrl('/api')).toBe(false))
  })

  test('a relative path is a problem in the native shell', () => {
    withWindow({ Capacitor: { isNativePlatform: () => true } }, () =>
      expect(needsServerUrl('/api')).toBe(true),
    )
  })

  test('an absolute server is fine natively', () => {
    withWindow({ Capacitor: { isNativePlatform: () => true } }, () =>
      expect(needsServerUrl('https://inkling.example.ts.net/api')).toBe(false),
    )
  })

  test('http counts as absolute — a LAN address is a legitimate choice', () => {
    withWindow({ Capacitor: { isNativePlatform: () => true } }, () =>
      expect(needsServerUrl('http://192.0.2.10:8787/api')).toBe(false),
    )
  })
})
