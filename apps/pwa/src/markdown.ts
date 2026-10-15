/**
 * A small Markdown renderer, safe by construction.
 *
 * Deliberately not a library: the input is escaped *first*, then a fixed set of
 * transformations is applied to the escaped text. Nothing in the output can come
 * from the input except text and a few tags we emitted ourselves, so there is no
 * sanitising pass to get wrong.
 *
 * It covers what someone actually writes in a note — headings, lists, quotes, code,
 * bold, italics, links — and leaves everything else as the text it is.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Only http(s), so a link cannot become `javascript:`. */
function safeUrl(url: string): string | null {
  const trimmed = url.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

function inline(escaped: string): string {
  let out = escaped
  // Code first, so its contents are not treated as anything else.
  out = out.replace(/`([^`]+)`/g, '<code class="md-code">$1</code>')
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  out = out.replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<em>$2</em>')
  out = out.replace(/(^|[\s(])_([^_\n]+)_/g, '$1<em>$2</em>')
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, href: string) => {
    const url = safeUrl(href.replace(/&amp;/g, '&'))
    return url ? `<a href="${url}" target="_blank" rel="noreferrer">${label}</a>` : match
  })
  // A bare URL becomes a link, which is most of what gets captured.
  out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (match, lead: string, url: string) => {
    const safe = safeUrl(url)
    return safe ? `${lead}<a href="${safe}" target="_blank" rel="noreferrer">${url}</a>` : match
  })
  return out
}

export function renderMarkdown(source: string): string {
  const lines = escapeHtml(source).split('\n')
  const blocks: string[] = []
  let paragraph: string[] = []
  let list: string[] = []
  let quote: string[] = []
  let code: string[] | null = null

  const flushParagraph = () => {
    if (paragraph.length > 0) blocks.push(`<p>${inline(paragraph.join(' '))}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (list.length > 0) {
      blocks.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`)
    }
    list = []
  }
  const flushQuote = () => {
    if (quote.length > 0) {
      blocks.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`)
    }
    quote = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (const line of lines) {
    if (line.trim().startsWith('```')) {
      if (code === null) {
        flushAll()
        code = []
      } else {
        blocks.push(`<pre class="md-pre"><code>${code.join('\n')}</code></pre>`)
        code = null
      }
      continue
    }
    if (code !== null) {
      code.push(line)
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushAll()
      const level = heading[1]?.length ?? 1
      blocks.push(`<h${level} class="md-h">${inline(heading[2] ?? '')}</h${level}>`)
      continue
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s-*_]*$/.test(line)) {
      flushAll()
      blocks.push('<hr />')
      continue
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      flushParagraph()
      flushQuote()
      list.push(bullet[1] ?? '')
      continue
    }

    const quoted = /^\s*&gt;\s?(.*)$/.exec(line)
    if (quoted) {
      flushParagraph()
      flushList()
      quote.push(quoted[1] ?? '')
      continue
    }

    if (line.trim() === '') {
      flushAll()
      continue
    }

    flushList()
    flushQuote()
    paragraph.push(line.trim())
  }

  if (code !== null) blocks.push(`<pre class="md-pre"><code>${code.join('\n')}</code></pre>`)
  flushAll()

  return blocks.join('')
}
