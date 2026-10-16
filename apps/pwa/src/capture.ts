import type { BlipType, CaptureInput, Visibility } from '@inkling/domain'

export interface CaptureDraft {
  kind: 'text' | 'url' | 'image'
  text?: string
  url?: string
  file?: File
  type?: BlipType
  /**
   * Who may see it, decided here rather than by the fold.
   *
   * Whether new Inklings start shared is a preference, and a preference applied later
   * would silently re-share things written under a different one.
   */
  visibility?: Visibility
}

/** Best-effort blip type when the user doesn't pick one. */
export function guessType(input: CaptureInput): BlipType {
  if (input.kind === 'url') return 'reference'
  if (input.kind === 'image') return 'insight'
  const text = (input.text ?? '').trim()
  if (!text) return 'other'
  if (text.endsWith('?')) return 'question'
  if (/^(try|learn|read|explore|look into|start|visit|set up)\b/i.test(text)) return 'quest'
  if (/^(i want|i'd like|i wish|i long|one day)\b/i.test(text)) return 'yearning'
  if (/^(maybe|i wonder|i noticed|i realised|i realized)\b/i.test(text)) return 'insight'
  return 'idea'
}

/**
 * The first link in what somebody typed.
 *
 * One field holds everything now, so a pasted address is not a separate thing for a separate
 * box — it is part of what was written, and it is also the link. Both are kept: the words as
 * they were written, and the address on its own so it can be opened.
 */
export function findUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s<>"')\]]+/i)
  if (!match) return null
  // Trailing punctuation belongs to the sentence rather than the address: "…/page." is a
  // sentence that ends in a link, and the full stop is not part of the path.
  return match[0].replace(/[.,;:!?]+$/, '')
}

/** Whether that is all that was written. */
export function isOnlyALink(text: string): boolean {
  const url = findUrl(text)
  return Boolean(url && text.replace(url, '').trim().length === 0)
}

/** The blip body — the human-readable core of a capture. */
export function inferBody(input: CaptureInput): string | undefined {
  const text = input.text?.trim()
  if (input.kind === 'url') {
    // The address on its own is not a body. Repeating it would make the URL the title, when
    // the site is the title — so a capture that is nothing but a link is titled by its
    // hostname and carries no body at all. Anything written around the link is.
    return text && text !== input.url?.trim() ? text : undefined
  }
  return text || undefined
}

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'to',
  'of',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'how',
  'why',
  'what',
  'this',
  'that',
  'it',
  'its',
  'i',
  'my',
  'me',
  'about',
  'into',
  'from',
  'be',
  'was',
  'were',
  'as',
  'at',
  'by',
  'if',
  'so',
  'not',
  'do',
  'does',
  'can',
  'could',
])

/**
 * Cheap topic extraction. These topics double as resurfacing triggers, so a
 * shared word between blips is deliberately meaningful.
 */
export function extractTopics(text: string, url?: string): string[] {
  const words = text.toLowerCase().match(/[a-z][a-z'-]{3,}/g) ?? []
  const freq = new Map<string, number>()
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue
    freq.set(word, (freq.get(word) ?? 0) + 1)
  }
  const topics = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([word]) => word)
  if (url) {
    try {
      const labels = new URL(url).hostname
        .replace(/^www\./, '')
        .split('.')
        // A two-letter leading label is a locale, not a name: "en.wikipedia.org" is
        // Wikipedia, and "en" is not a topic anybody would recognise or want to match on.
        .filter((label) => label.length > 2 || !/^[a-z]{2}$/.test(label))
      const site = labels[0]
      if (site) topics.push(site)
    } catch {
      // Not a parseable URL; skip the site topic.
    }
  }
  return [...new Set(topics.filter(Boolean))].slice(0, 4)
}

/**
 * The first image in a paste or a drop, if there is one.
 *
 * Shared because both places that take writing take pictures the same way — the field that
 * starts an Inkling, and the field that adds to one — and a second copy of this would be a
 * second place for "it worked when I started one but not when I added to it" to live.
 */
export function imageFrom(data: DataTransfer | null): File | null {
  if (!data) return null
  return [...data.files].find((file) => file.type.startsWith('image/')) ?? null
}

/** What was written, as opposed to what it was written into. */
export interface EntryDraft {
  text?: string
  url?: string
  file?: File
}
