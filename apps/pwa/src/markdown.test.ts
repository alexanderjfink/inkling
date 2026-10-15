import { describe, expect, test } from 'bun:test'
import { renderMarkdown } from './markdown'

describe('renderMarkdown', () => {
  test('turns a heading into a heading, not literal hashes', () => {
    expect(renderMarkdown('## Social Platform')).toContain('<h2')
    expect(renderMarkdown('## Social Platform')).toContain('Social Platform')
    expect(renderMarkdown('## Social Platform')).not.toContain('##')
  })

  test('handles paragraphs, bold, italics and code', () => {
    const html = renderMarkdown('A **bold** word and an *italic* one, plus `code`.')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<em>italic</em>')
    expect(html).toContain('<code')
  })

  test('makes lists and quotes', () => {
    expect(renderMarkdown('- one\n- two')).toContain('<li>one</li>')
    expect(renderMarkdown('> a thought')).toContain('<blockquote>')
  })

  test('leaves blank lines as paragraph breaks', () => {
    const html = renderMarkdown('first para\n\nsecond para')
    expect(html.match(/<p>/g)).toHaveLength(2)
  })

  test('links http and https, and autolinks bare URLs', () => {
    expect(renderMarkdown('[the story](https://example.com/a)')).toContain(
      '<a href="https://example.com/a"',
    )
    expect(renderMarkdown('see https://example.com/b now')).toContain(
      '<a href="https://example.com/b"',
    )
  })

  test('escapes HTML, so a note cannot inject markup', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  test('refuses a javascript: link, leaving it as text', () => {
    const html = renderMarkdown('[click](javascript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).toContain('click')
  })

  test('a code fence is code, and its contents are not interpreted', () => {
    const html = renderMarkdown('```\n# not a heading\n```')
    expect(html).toContain('<pre')
    expect(html).not.toContain('<h1')
  })

  test('plain text stays plain', () => {
    expect(renderMarkdown('just a sentence')).toBe('<p>just a sentence</p>')
  })

  test('an empty note renders as nothing', () => {
    expect(renderMarkdown('')).toBe('')
  })
})
