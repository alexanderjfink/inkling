import { describe, expect, test } from 'bun:test'
import { extractTopics, findUrl, inferBody, isOnlyALink } from './capture'

/**
 * One field holds everything now, so these decide what a capture actually is. They are the
 * part of the simplification that can be wrong in a way nobody would notice: a pasted link
 * that ends up titled with its own address looks like a bug in the title, not in the input.
 */
describe('finding a link in what was written', () => {
  test('finds an address with words around it', () => {
    const text = 'worth reading https://example.com/an-article about sourdough'
    expect(findUrl(text)).toBe('https://example.com/an-article')
    expect(isOnlyALink(text)).toBe(false)
  })

  test('finds one on its own', () => {
    expect(findUrl('https://example.com')).toBe('https://example.com')
    expect(isOnlyALink('https://example.com')).toBe(true)
  })

  test('ignores a line of words that merely mentions a site', () => {
    expect(findUrl('look at example.com when you get a chance')).toBeNull()
  })

  test('stops at punctuation, which is rarely part of the address', () => {
    expect(findUrl('(see https://example.com/page)')).toBe('https://example.com/page')
    expect(findUrl('https://example.com/page.')).toBe('https://example.com/page')
  })

  test('a link with a sentence around it is not only a link', () => {
    expect(isOnlyALink('https://example.com — this is the one I meant')).toBe(false)
  })
})

describe('what a capture becomes', () => {
  test('a link on its own has no body, so the site is the title', () => {
    // Repeating the address as the body would make the URL the title of something whose
    // title is obviously the site.
    expect(
      inferBody({ kind: 'url', url: 'https://example.com', text: 'https://example.com' }),
    ).toBeUndefined()
  })

  test('a link with words around it keeps the words', () => {
    const text = 'the thing about starters https://example.com'
    expect(inferBody({ kind: 'url', url: 'https://example.com', text })).toBe(text)
  })

  test('plain text is its own body', () => {
    expect(inferBody({ kind: 'text', text: '  something I noticed  ' })).toBe('something I noticed')
  })

  test('an image with no words has no body', () => {
    expect(inferBody({ kind: 'image' })).toBeUndefined()
  })

  test('an image with a caption keeps the caption', () => {
    expect(inferBody({ kind: 'image', text: 'the light on the desk' })).toBe(
      'the light on the desk',
    )
  })
})

describe('the site a link points at', () => {
  test('is a topic, so a link can find other things like it', () => {
    expect(extractTopics('', 'https://en.wikipedia.org/wiki/Sourdough')).toContain('wikipedia')
  })

  test('and is the name, not the locale in front of it', () => {
    // "en" is not a topic anybody would recognise or want to match on.
    expect(extractTopics('', 'https://en.wikipedia.org/wiki/Sourdough')).not.toContain('en')
    expect(extractTopics('', 'https://www.bbc.co.uk/news')).toContain('bbc')
  })

  test('an address that will not parse simply has no site topic', () => {
    expect(extractTopics('something I noticed', 'not a url')).toEqual(['noticed', 'something'])
  })
})
