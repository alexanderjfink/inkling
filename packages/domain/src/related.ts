import type { Blip } from './project'

/**
 * How blips relate to each other.
 *
 * Deliberately not embedding-first. The strongest signal is that you *said* two
 * blips are related; the next is that they share a topic you named. Embeddings are
 * a third, optional signal — because plenty of good providers (OpenCode Go,
 * Anthropic) offer no embeddings at all, and related blips must still work.
 */

export interface RelatednessOptions {
  /** Embeddings keyed by blip id. Absent or partial is fine. */
  embeddings?: Map<string, number[]>
  limit?: number
  /** Include blips that are already explicitly linked. */
  includeLinked?: boolean
}

export interface RelatedBlip {
  blip: Blip
  score: number
  /** Why they are related, in words. Shown in the UI and usable as a move prompt. */
  reasons: string[]
}

const WEIGHT_LINKED = 1
const WEIGHT_TOPIC = 0.6
const WEIGHT_MEANING = 0.8
const WEIGHT_WORDING = 0.3
/** Below this, two blips are not meaningfully related. */
const MIN_SCORE = 0.15

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
  'was',
  'were',
  'be',
  'been',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'i',
  'my',
  'me',
  'we',
  'you',
  'your',
  'as',
  'at',
  'by',
  'if',
  'so',
  'not',
  'do',
  'does',
  'did',
  'can',
  'could',
  'about',
  'into',
  'from',
  'how',
  'why',
  'what',
  'when',
  'where',
  'which',
  'who',
  'there',
])

export function tokens(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z'-]{2,}/g) ?? []
  const out = new Set<string>()
  for (const word of words) {
    if (STOP_WORDS.has(word)) continue
    out.add(word)
  }
  return out
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const value of a) if (b.has(value)) shared += 1
  return shared / (a.size + b.size - shared)
}

export function cosine(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    dot += x * y
    normA += x * x
    normB += y * y
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

/** Everything a blip is "about", for comparing one against another. */
export function blipText(blip: Blip): string {
  const entries = blip.entries
    .map((entry) => entry.text ?? entry.url ?? '')
    .filter((text) => text.length > 0)
    .join(' ')
  return [blip.title, blip.body, blip.topics.join(' '), entries].join(' ').trim()
}

export function sharedTopics(a: Blip, b: Blip): string[] {
  const inB = new Set(b.topics)
  return a.topics.filter((topic) => inB.has(topic))
}

export function relatedness(
  a: Blip,
  b: Blip,
  embeddings?: Map<string, number[]>,
): { score: number; reasons: string[] } {
  const reasons: string[] = []
  let score = 0

  if (a.links.includes(b.id) || b.links.includes(a.id)) {
    score += WEIGHT_LINKED
    reasons.push('you linked them')
  }

  const topics = sharedTopics(a, b)
  if (topics.length > 0) {
    score += WEIGHT_TOPIC * Math.min(1, topics.length / 2)
    reasons.push(`shared topic: ${topics.join(', ')}`)
  }

  const vectorA = embeddings?.get(a.id)
  const vectorB = embeddings?.get(b.id)
  if (vectorA && vectorB) {
    const similarity = cosine(vectorA, vectorB)
    if (similarity > 0.6) {
      score += WEIGHT_MEANING * ((similarity - 0.6) / 0.4)
      reasons.push('similar in meaning')
    }
  }

  const wording = jaccard(tokens(blipText(a)), tokens(blipText(b)))
  if (wording > 0.08) {
    score += WEIGHT_WORDING * Math.min(1, wording / 0.3)
    if (topics.length === 0) reasons.push('similar wording')
  }

  return { score, reasons }
}

/** The blips most worth putting next to this one, best first. */
export function topRelated(
  blip: Blip,
  all: Blip[],
  options: RelatednessOptions = {},
): RelatedBlip[] {
  const limit = options.limit ?? 3
  const linked = new Set(blip.links)
  const results: RelatedBlip[] = []

  for (const other of all) {
    if (other.id === blip.id || other.deleted) continue
    if (!options.includeLinked && linked.has(other.id)) continue
    const { score, reasons } = relatedness(blip, other, options.embeddings)
    if (score < MIN_SCORE) continue
    results.push({ blip: other, score, reasons })
  }

  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.blip.created.localeCompare(b.blip.created) ||
        a.blip.id.localeCompare(b.blip.id),
    )
    .slice(0, limit)
}
