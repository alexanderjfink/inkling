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

/** The blip body — the human-readable core of a capture. */
export function inferBody(input: CaptureInput): string | undefined {
  const text = input.text?.trim()
  if (input.kind === 'url') return text || input.url
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
      const host = new URL(url).hostname.replace(/^www\./, '').split('.')[0]
      if (host) topics.push(host)
    } catch {
      // Not a parseable URL; skip the host topic.
    }
  }
  return [...new Set(topics.filter(Boolean))].slice(0, 4)
}
