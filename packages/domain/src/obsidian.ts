import type { LLMProvider } from './llm'
import type { Blip } from './project'

/**
 * Turning a blip into an Obsidian note.
 *
 * The point of promotion is not to move the text — it is to end the ambiguity. A
 * blip that has been sitting in the feed for weeks becomes a note with the
 * accumulated meaning, and a short list of *specific* next steps. That last part is
 * the whole value: the source material's complaint is that blips "lack clear next
 * steps", so a note without them would just move the problem.
 *
 * The frontmatter is deliberately mdbase-shaped (a `type` plus typed fields), so the
 * same renderer can feed a typed Markdown collection later without divergence.
 */

export interface NextStepsDraft {
  steps: string[]
  generatedBy: 'llm' | 'heuristic'
}

export function buildNextStepsPrompt(
  blip: Blip,
  related: Blip[] = [],
): { system: string; prompt: string } {
  const system = [
    'You turn a captured idea into concrete next steps.',
    'Write between one and three steps.',
    'Each step must be specific and immediately actionable — something a person could',
    'start in one sitting. Never write vague steps like "explore this further" or',
    '"do more research". Prefer a verb, an object, and a finish line.',
    'Reply with JSON only.',
  ].join(' ')

  const entries = blip.entries
    .slice(-8)
    .map((entry) => `- (${entry.kind}) ${entry.text ?? entry.url ?? ''}`)
    .join('\n')

  const prompt = [
    `TYPE: ${blip.type}`,
    `TITLE: ${blip.title}`,
    blip.body && blip.body !== blip.title ? `BODY: ${blip.body}` : '',
    blip.topics.length > 0 ? `TOPICS: ${blip.topics.join(', ')}` : '',
    blip.input?.url ? `SOURCE: ${blip.input.url}` : '',
    entries ? `WHAT THEY WROTE ALREADY:\n${entries}` : '',
    related.length > 0 ? `RELATED NOTES:\n${related.map((b) => `- ${b.title}`).join('\n')}` : '',
    '',
    'Reply with exactly:',
    '{"steps": ["...", "..."]}',
  ]
    .filter(Boolean)
    .join('\n')

  return { system, prompt }
}

/** Pull a steps array out of a model reply, tolerating prose or code fences. */
export function parseNextSteps(text: string): string[] | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }

  const raw = (parsed as { steps?: unknown }).steps
  if (!Array.isArray(raw)) return null

  const steps = raw
    .filter((step): step is string => typeof step === 'string')
    .map((step) => step.trim())
    .filter((step) => step.length > 0 && step.length <= 300)
    .slice(0, 3)

  return steps.length > 0 ? steps : null
}

/**
 * What to offer when there is no model. Honest rather than clever: it names the one
 * obvious action if there is one, and otherwise says plainly that the step is yours
 * to define.
 */
export function heuristicNextSteps(blip: Blip): string[] {
  const steps: string[] = []
  const url = blip.input?.url ?? blip.context?.ref
  if (url) steps.push(`Read ${url} and keep one sentence that matters.`)

  const lastNote = [...blip.entries].reverse().find((entry) => entry.kind === 'note' && entry.text)
  if (lastNote?.text) {
    steps.push(`Decide what "${truncate(lastNote.text, 60)}" leads to, and write it here.`)
  }

  if (steps.length === 0) steps.push('Write the next concrete action for this note.')
  return steps
}

export async function draftNextSteps(
  blip: Blip,
  options: { provider?: LLMProvider; related?: Blip[] } = {},
): Promise<NextStepsDraft> {
  const provider = options.provider
  if (!provider) return { steps: heuristicNextSteps(blip), generatedBy: 'heuristic' }

  try {
    if (!(await provider.available())) {
      return { steps: heuristicNextSteps(blip), generatedBy: 'heuristic' }
    }
    const { system, prompt } = buildNextStepsPrompt(blip, options.related ?? [])
    const steps = parseNextSteps(await provider.completeStructured({ system, prompt }))
    if (!steps) return { steps: heuristicNextSteps(blip), generatedBy: 'heuristic' }
    return { steps, generatedBy: 'llm' }
  } catch {
    return { steps: heuristicNextSteps(blip), generatedBy: 'heuristic' }
  }
}

function truncate(text: string, length: number): string {
  return text.length <= length ? text : `${text.slice(0, length - 1)}…`
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : 'blip'
}

export function noteFilename(blip: Blip): string {
  return `${slugify(blip.title)}-${blip.id.slice(-6).toLowerCase()}.md`
}

/** Path relative to the vault root. */
export function notePath(folder: string, blip: Blip): string {
  const clean = folder.replace(/^\/+|\/+$/g, '')
  return clean.length > 0 ? `${clean}/${noteFilename(blip)}` : noteFilename(blip)
}

function frontmatter(blip: Blip, now: Date): string {
  const tags = [`blip/${blip.type}`, ...blip.topics.map((topic) => `topic/${slugify(topic)}`)]
  const lines = [
    '---',
    'type: evergreen',
    `blip_id: ${blip.id}`,
    `blip_type: ${blip.type}`,
    `title: ${JSON.stringify(blip.title)}`,
    `created: ${blip.created.slice(0, 10)}`,
    `promoted: ${now.toISOString().slice(0, 10)}`,
    'tags:',
    ...tags.map((tag) => `  - ${tag}`),
  ]
  const source = blip.input?.url ?? blip.context?.ref
  if (source) lines.push(`source: ${source}`)
  lines.push('---')
  return lines.join('\n')
}

function renderEntries(blip: Blip): string {
  const lines: string[] = []
  for (const entry of blip.entries) {
    const date = entry.at.slice(0, 10)
    if (entry.kind === 'media') {
      lines.push(`- ${date} — attachment \`${entry.mediaId ?? 'unknown'}\``)
      continue
    }
    if (entry.kind === 'link' && entry.url) {
      lines.push(`- ${date} — [${entry.text ?? entry.url}](${entry.url})`)
      continue
    }
    if (entry.text) lines.push(`- ${date} — ${entry.text}`)
  }
  return lines.join('\n')
}

export interface NoteOptions {
  nextSteps: string[]
  related?: Blip[]
  now?: Date
}

/** The note itself: meaning first, then the steps that end the ambiguity. */
export function renderObsidianNote(blip: Blip, options: NoteOptions): string {
  const now = options.now ?? new Date()
  const sections: string[] = [frontmatter(blip, now), '', `# ${blip.title}`]

  if (blip.body && blip.body !== blip.title) sections.push('', blip.body)

  const entries = renderEntries(blip)
  if (entries) sections.push('', '## What I collected', '', entries)

  sections.push('', '## Next steps', '')
  for (const step of options.nextSteps) sections.push(`- [ ] ${step}`)

  const related = options.related ?? []
  const context: string[] = []
  const source = blip.input?.url ?? blip.context?.ref
  if (source) context.push(`Source: ${source}`)
  if (blip.topics.length > 0) context.push(`Topics: ${blip.topics.join(', ')}`)
  if (related.length > 0) {
    context.push('', 'Related:')
    for (const other of related) context.push(`- [[${other.title}]]`)
  }
  if (context.length > 0) sections.push('', '## Context', '', ...context)

  return `${sections.join('\n')}\n`
}
