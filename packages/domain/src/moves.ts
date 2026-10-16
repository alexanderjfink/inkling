import { BLIP_TYPES, type BlipType, type MoveSpec } from './events'
import type { LLMProvider } from './llm'
import type { Blip } from './project'

/**
 * Moves: scaffolded microtasks that move a blip forward.
 *
 * Three rules, taken from the source material, are baked into the library below:
 *
 *   1. A move is a prompt *to you*, never something the system does for you.
 *   2. Every move is time-boxed and low-energy — sized for a phone, on a sofa.
 *   3. Every move has a concrete goal, so "done" is obvious and progress is visible.
 *
 * The library is data, not code. The LLM's job is to choose among these and adapt
 * the wording; it is not asked to invent tasks from nothing until the playbook has
 * been proven to work.
 *
 * A move marked `wantsMaterial` also brings you something to react to — the model
 * supplies a search phrase, and the server resolves it to a real page. The paper's
 * complaint about naive resurfacing was showing the same blank prompt again; new
 * material is the fix.
 */
export interface MoveTemplate {
  id: string
  /** Which blip types this suits. Generic moves list every type. */
  blipTypes: BlipType[]
  title: string
  why: string
  timeLimitSec: number
  goal: string
  steps?: string[]
  successCriteria?: string
  /** Only offered when the blip has a URL to fetch. */
  needsUrl?: boolean
  /** The move is better with something to read, so a search phrase is asked for. */
  wantsMaterial?: boolean
}

const ALL_TYPES: BlipType[] = [...BLIP_TYPES]

/** The last-resort move: always applicable, always short. */
const GENERIC_REACT: MoveTemplate = {
  id: 'any.react',
  blipTypes: ALL_TYPES,
  title: 'React to this in one sentence',
  why: 'A single reaction is enough to keep a blip alive.',
  timeLimitSec: 90,
  goal: 'One sentence',
}

export const MOVE_LIBRARY: MoveTemplate[] = [
  // ── questions ───────────────────────────────────────────────────────────────
  {
    id: 'question.ramble',
    blipTypes: ['question'],
    title: 'Set a 2-minute timer and ramble about how this came up',
    why: 'Saying where it came from usually reveals what you actually want to know.',
    timeLimitSec: 120,
    goal: 'Say one thing about this you had not put into words yet',
  },
  {
    id: 'question.subquestions',
    blipTypes: ['question'],
    title: 'Break the question into three smaller ones',
    why: 'A question too big to answer is usually several questions wearing a coat.',
    timeLimitSec: 180,
    goal: 'Write three smaller questions',
  },
  {
    id: 'question.oneSentence',
    blipTypes: ['question'],
    title: 'Answer it in one sentence, as if you had to',
    why: 'A forced answer is often better than the hedged one you have been carrying.',
    timeLimitSec: 120,
    goal: 'One sentence you would actually say out loud',
  },
  {
    id: 'question.changeMyMind',
    blipTypes: ['question'],
    title: 'What would change your mind?',
    why: 'Knowing what would settle a question tells you whether it is worth settling.',
    timeLimitSec: 120,
    goal: 'One specific thing you could find out',
  },
  {
    id: 'question.opposite',
    blipTypes: ['question'],
    title: 'Argue the opposite for two minutes',
    why: 'The strongest case against is the fastest way to see what you actually think.',
    timeLimitSec: 120,
    goal: 'The best version of the view you disagree with',
  },
  {
    id: 'question.background',
    blipTypes: ['question'],
    title: 'Look up the background, then say what surprised you',
    why: 'You are usually asking from further behind than you think.',
    timeLimitSec: 240,
    goal: 'One thing you did not know before',
    wantsMaterial: true,
  },
  {
    id: 'question.who',
    blipTypes: ['question'],
    title: 'Name one person who would know',
    why: 'Deciding who to ask converts a private puzzle into a possible conversation.',
    timeLimitSec: 60,
    goal: 'One name, and why them',
  },

  // ── references ──────────────────────────────────────────────────────────────
  {
    id: 'reference.firstLook',
    blipTypes: ['reference'],
    title: 'Look at what this page actually says',
    why: 'You captured the link before you knew whether it was worth reading.',
    timeLimitSec: 180,
    goal: 'Keep one sentence that surprised you',
    needsUrl: true,
  },
  {
    id: 'reference.number',
    blipTypes: ['reference'],
    title: 'Skim for one number or fact worth keeping',
    why: 'One concrete fact outlives the whole article it came from.',
    timeLimitSec: 180,
    goal: 'One number or fact, in your own words',
    needsUrl: true,
  },
  {
    id: 'reference.who',
    blipTypes: ['reference'],
    title: 'Find out who made this, and why',
    why: 'Provenance is usually the fastest way to judge whether to trust something.',
    timeLimitSec: 180,
    goal: 'One sentence on who and why',
    wantsMaterial: true,
  },
  {
    id: 'reference.oneSentence',
    blipTypes: ['reference'],
    title: 'Read one paragraph and keep one sentence',
    why: 'One kept sentence beats a bookmarked article you never open.',
    timeLimitSec: 180,
    goal: 'One sentence, in your own words',
  },
  {
    id: 'reference.relevance',
    blipTypes: ['reference'],
    title: 'Write why this might matter to you',
    why: 'Relevance is the thing that decays fastest about a saved link.',
    timeLimitSec: 120,
    goal: 'One sentence of relevance, or decide it is not relevant',
  },

  // ── insights ────────────────────────────────────────────────────────────────
  {
    id: 'insight.claim',
    blipTypes: ['insight'],
    title: 'State it as a claim you could defend',
    why: 'A noticing becomes usable once it can be wrong.',
    timeLimitSec: 120,
    goal: 'One sentence you would stand behind',
  },
  {
    id: 'insight.whatIfFalse',
    blipTypes: ['insight'],
    title: 'What would have to be true for this to be false?',
    why: 'Testability is what separates an insight from a mood.',
    timeLimitSec: 150,
    goal: 'One condition that would disprove it',
  },
  {
    id: 'insight.sceptic',
    blipTypes: ['insight'],
    title: 'Say it out loud to an imaginary sceptic',
    why: 'You find the soft spot the moment you have to say it to someone unimpressed.',
    timeLimitSec: 150,
    goal: 'The strongest objection they would raise',
  },
  {
    id: 'insight.counterexamples',
    blipTypes: ['insight'],
    title: 'Find two counterexamples',
    why: 'The edges of an idea are more informative than its centre.',
    timeLimitSec: 240,
    goal: 'Two counterexamples, or a reason there are none',
  },
  {
    id: 'insight.elsewhere',
    blipTypes: ['insight'],
    title: 'Ask where else this applies',
    why: 'Ideas earn their keep by travelling.',
    timeLimitSec: 180,
    goal: 'One other domain where this holds',
  },
  {
    id: 'insight.background',
    blipTypes: ['insight'],
    title: 'Is this a thing other people have named?',
    why: 'Someone has usually thought about it for longer than you have.',
    timeLimitSec: 240,
    goal: 'The nearest existing idea, and how yours differs',
    wantsMaterial: true,
  },

  // ── ideas ───────────────────────────────────────────────────────────────────
  {
    id: 'idea.smallestTest',
    blipTypes: ['idea'],
    title: 'What is the smallest test?',
    why: 'Cheap tests make it safe to find out you were wrong.',
    timeLimitSec: 120,
    goal: 'One test you could run this week',
  },
  {
    id: 'idea.cheapest',
    blipTypes: ['idea'],
    title: 'What is the cheapest version of this?',
    why: 'The cheap version is the one that actually gets made.',
    timeLimitSec: 150,
    goal: 'One version you could build in an afternoon',
  },
  {
    id: 'idea.stranger',
    blipTypes: ['idea'],
    title: 'Describe it so a stranger would understand',
    why: 'If it cannot survive being explained plainly, it is not yet an idea.',
    timeLimitSec: 150,
    goal: 'Two sentences, no jargon',
  },
  {
    id: 'idea.prior',
    blipTypes: ['idea'],
    title: 'Who has already done this?',
    why: 'Almost nothing is new; finding the ancestors saves months.',
    timeLimitSec: 240,
    goal: 'One existing attempt, and what it missed',
    wantsMaterial: true,
  },
  {
    id: 'idea.variations',
    blipTypes: ['idea'],
    title: 'Sketch three variations',
    why: 'The first version is rarely the one worth keeping.',
    timeLimitSec: 240,
    goal: 'Three variations, however rough',
  },

  // ── quests ──────────────────────────────────────────────────────────────────
  {
    id: 'quest.firstSession',
    blipTypes: ['quest'],
    title: 'What is the first 30 minutes?',
    why: 'Enormous things become possible the moment the first step is small.',
    timeLimitSec: 180,
    goal: 'A first step you could do today',
  },
  {
    id: 'quest.uglyFirst',
    blipTypes: ['quest'],
    title: 'Do the ugliest possible first version',
    why: 'The point of the first pass is to have something to be disappointed by.',
    timeLimitSec: 240,
    goal: 'Something exists that did not before',
  },
  {
    id: 'quest.notWorthIt',
    blipTypes: ['quest'],
    title: 'What would make this not worth doing?',
    why: 'Naming the exit condition is how a quest stops quietly rotting.',
    timeLimitSec: 150,
    goal: 'One condition under which you would stop',
  },
  {
    id: 'quest.threeSessions',
    blipTypes: ['quest'],
    title: 'Break it into three sessions',
    why: 'Three sittings is usually the difference between a hobby and a bookmark.',
    timeLimitSec: 240,
    goal: 'Three named sessions',
  },
  {
    id: 'quest.why',
    blipTypes: ['quest'],
    title: 'Write why you want this at all',
    why: 'A quest without a reason is the first thing to rot.',
    timeLimitSec: 120,
    goal: 'One honest sentence, or decide to let it go',
  },

  // ── yearnings ───────────────────────────────────────────────────────────────
  {
    id: 'yearning.smallest',
    blipTypes: ['yearning'],
    title: 'Name the smallest version of this',
    why: 'Yearnings are usually satisfiable in miniature long before they are in full.',
    timeLimitSec: 120,
    goal: 'The smallest version you would actually do',
  },
  {
    id: 'yearning.nearby',
    blipTypes: ['yearning'],
    title: 'Who near you is already doing this?',
    why: 'Most yearnings are one introduction away from being a Tuesday.',
    timeLimitSec: 150,
    goal: 'One person, group or place within reach',
  },
  {
    id: 'yearning.who',
    blipTypes: ['yearning'],
    title: 'Who else would want this?',
    why: 'Yearnings that need other people need one name to start.',
    timeLimitSec: 120,
    goal: 'One person to ask',
  },
  {
    id: 'yearning.step',
    blipTypes: ['yearning'],
    title: 'One step you could take this week',
    why: 'A week is long enough to be real and short enough to be honest.',
    timeLimitSec: 120,
    goal: 'One step, with a day attached',
  },

  // ── any blip ────────────────────────────────────────────────────────────────
  {
    id: 'any.read',
    blipTypes: ALL_TYPES,
    title: 'Read a short summary, then keep one sentence',
    why: 'Something concrete to react to beats staring at the same prompt again.',
    timeLimitSec: 240,
    goal: 'One sentence, in your own words, that you did not have before',
    wantsMaterial: true,
  },
  {
    id: 'any.sentenceInAYear',
    blipTypes: ALL_TYPES,
    title: 'Write the sentence you would want to find in a year',
    why: 'Notes are for the person you will be, not the one you are.',
    timeLimitSec: 120,
    goal: 'One sentence, written for later',
  },
  {
    id: 'any.examples',
    blipTypes: ALL_TYPES,
    title: 'Collect three examples',
    why: 'Three examples usually tell you what you actually mean.',
    timeLimitSec: 300,
    goal: 'Three examples',
  },
  {
    id: 'any.related',
    blipTypes: ALL_TYPES,
    title: 'How is this related to what you are already working on?',
    why: 'Connection to live work is what keeps a blip from going stale.',
    timeLimitSec: 120,
    goal: 'One connection, or a reason there is none',
  },
  GENERIC_REACT,
]

const FALLBACK_TEMPLATE = GENERIC_REACT

export function toMoveSpec(
  template: MoveTemplate,
  generatedBy: 'playbook' | 'llm' = 'playbook',
): MoveSpec {
  return {
    id: template.id,
    title: template.title,
    why: template.why,
    timeLimitSec: template.timeLimitSec,
    goal: template.goal,
    steps: template.steps,
    successCriteria: template.successCriteria,
    playbook: template.id.split('.')[0] ?? 'any',
    generatedBy,
  }
}

export interface MoveContext {
  blip: Blip
  related?: Blip[]
  /** Move ids already shown for this blip, most recent last. */
  seenMoveIds?: string[]
}

function isGeneric(template: MoveTemplate): boolean {
  return template.blipTypes.length === BLIP_TYPES.length
}

function hasUrl(blip: Blip): boolean {
  return Boolean(blip.input?.url ?? blip.context?.ref)
}

/**
 * Where a search link goes.
 *
 * Here rather than on the server because the app needs it too: when the server cannot be
 * reached, a move should still send you somewhere rather than losing its links entirely.
 *
 * DuckDuckGo because it needs no key, takes the phrase in the query string, and does not
 * personalise — the same phrase gives the same page to everybody, which is what keeps
 * this an honest "go and look" rather than an opinion about the person searching.
 */
export function searchUrl(phrase: string): string {
  return `https://duckduckgo.com/?q=${encodeURIComponent(phrase)}`
}

/**
 * What to look up if the model does not suggest anything better.
 *
 * The title is the blip's own summary of itself, so it is the right thing to search
 * for — minus any URL, which would only confuse a search engine.
 */
export function deriveQuery(blip: Blip): string {
  const withoutUrl = blip.title
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const topics = blip.topics.filter((topic) => !/^https?$/.test(topic)).slice(0, 2)
  const query = withoutUrl || topics.join(' ') || blip.body
  return query.slice(0, 120).trim()
}

/**
 * Playbook moves that suit this blip, best first. Type-specific beats generic,
 * never-shown beats shown, and short beats long — the shorter a move is, the more
 * likely it is to actually happen.
 */
export function candidateTemplates(ctx: MoveContext): MoveTemplate[] {
  const seen = ctx.seenMoveIds ?? []
  const applicable = MOVE_LIBRARY.filter(
    (template) =>
      template.blipTypes.includes(ctx.blip.type) && (!template.needsUrl || hasUrl(ctx.blip)),
  )
  const fresh = applicable.filter((template) => !seen.includes(template.id))
  const pool = fresh.length > 0 ? fresh : applicable
  const seenCount = (id: string) => seen.filter((entry) => entry === id).length

  return [...pool].sort((a, b) => {
    if (isGeneric(a) !== isGeneric(b)) return isGeneric(a) ? 1 : -1
    if (seenCount(a.id) !== seenCount(b.id)) return seenCount(a.id) - seenCount(b.id)
    return a.timeLimitSec - b.timeLimitSec || a.id.localeCompare(b.id)
  })
}

export function buildMovePrompt(
  ctx: MoveContext,
  candidates: MoveTemplate[],
): { system: string; prompt: string } {
  const system = [
    'You help someone make a small amount of progress on an idea they captured.',
    'You NEVER do the task for them and never answer their question.',
    'You choose ONE move from the supplied list and adapt its wording to this blip.',
    'A move is a prompt to the person: time-boxed, low-energy, doable on a phone in one sitting,',
    'with a concrete goal. Shorter is better. Never invent a task that is not on the list.',
    'Prefer a move that gives them something NEW to react to over one that asks them to stare',
    'at the same question again.',
    'If the move you choose is marked as looking something up, also supply a "query": a short,',
    'specific search phrase of two to eight words that would find the right page.',
    'Name the general idea rather than particular products or brands — "social annotation tools"',
    'finds an encyclopaedia article, a list of product names finds nothing at all.',
    'Never invent a URL — a search phrase is what is wanted.',
    'Reply with JSON only.',
  ].join(' ')

  const blip = ctx.blip
  const entries = blip.entries
    .slice(-5)
    .map((entry) => `- (${entry.kind}) ${entry.text ?? entry.url ?? entry.mediaId ?? ''}`)
    .join('\n')
  const related = (ctx.related ?? [])
    .slice(0, 4)
    .map((other) => `- ${other.title}`)
    .join('\n')

  // What has already been put in front of them. The same prompt twice is exactly the
  // "ugh, this again" the design exists to avoid, so the model is told what to avoid.
  const history = blip.moves
    .slice(-8)
    .map((entry) => `- "${entry.spec.title}" — ${entry.outcome === 'done' ? 'done' : 'put down'}`)
    .join('\n')

  // What has been judged bad here, and why.
  //
  // The strongest signal there is that a direction is wrong, and the only one that says
  // *why*. Without it the model has no way to know that the move it is about to offer is
  // the kind of thing that was just refused — which is exactly what a rejection means.
  const rejected = blip.rejections
    .slice(-5)
    .map(
      (rejection) =>
        `- "${rejection.spec.title}"${rejection.reason ? ` — ${rejection.reason}` : ''}`,
    )
    .join('\n')

  const menu = candidates
    .slice(0, 8)
    .map(
      (template) =>
        `- id: ${template.id}\n  title: ${template.title}\n  goal: ${template.goal}\n  seconds: ${template.timeLimitSec}${template.wantsMaterial ? '\n  looks something up: yes' : ''}`,
    )
    .join('\n')

  const prompt = [
    `BLIP TYPE: ${blip.type}`,
    `TITLE: ${blip.title}`,
    blip.body && blip.body !== blip.title ? `BODY: ${blip.body}` : '',
    blip.topics.length > 0 ? `TOPICS: ${blip.topics.join(', ')}` : '',
    entries ? `WHAT THEY HAVE ALREADY WRITTEN:\n${entries}` : '',
    related ? `RELATED BLIPS:\n${related}` : '',
    history ? `MOVES ALREADY PUT IN FRONT OF THEM:\n${history}` : '',
    rejected
      ? `JUDGED BAD FOR THIS BLIP, with the reason given — do not offer anything like these:\n${rejected}`
      : '',
    `TIMES THEY HAVE PUT THIS DOWN: ${blip.schedule.timesSkipped}`,
    '',
    `MOVES TO CHOOSE FROM:\n${menu}`,
    '',
    'Choose one id from the list and adapt its title, why and goal to this specific blip.',
    'Do not repeat a move they have already had: either pick a different one, or take the',
    'same kind of move from an angle you have not used yet.',
    'Where a move was judged bad, treat the reason as a correction: if it was too vague, be',
    'concrete; if it was too big, make it smaller; if it had nothing to do with this, use',
    "the blip's own words instead of a general angle.",
    'Keep the time limit under 5 minutes.',
    'Most moves should send them somewhere real to look — one to three short search',
    'phrases in `lookUp`. Phrases, never URLs: a link that does not exist is worse than',
    'no link, because it looks like an answer. Name the thing to find, not the question',
    '("starter MIDI keyboard latency", not "what keyboard should I buy").',
    'A move that is entirely about looking inward needs no phrases; leave lookUp empty.',
    'Reply with exactly:',
    '{"id": "<one id from the list>", "title": "...", "why": "...", "goal": "...", "timeLimitSec": 120, "lookUp": ["<short search phrase>"]}',
  ]
    .filter(Boolean)
    .join('\n')

  return { system, prompt }
}

interface RawMove {
  id?: unknown
  title?: unknown
  why?: unknown
  goal?: unknown
  timeLimitSec?: unknown
  steps?: unknown
  lookUp?: unknown
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** How many places one move is allowed to send you. More than this is a reading list. */
export const MAX_LOOK_UPS = 3
/** Long enough for "best starter MIDI keyboard for a phone app", short enough to be a search. */
const MAX_PHRASE = 120

/**
 * A list of search phrases from a model reply.
 *
 * Tolerates a bare string, because a model asked for a list of one will sometimes send
 * the one. Anything longer than a search phrase is dropped rather than trimmed: a whole
 * sentence in a search box returns nothing useful.
 */
function asPhrases(value: unknown): string[] {
  const items = Array.isArray(value) ? value : typeof value === 'string' ? [value] : []
  return items
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= MAX_PHRASE)
    .slice(0, MAX_LOOK_UPS)
}

/** Pull the first JSON object out of a model reply, tolerating prose or code fences. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = fenced?.[1] ?? text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/**
 * Validate a model reply against the candidate menu.
 *
 * The model may reword, but it must pick a real playbook id and produce a usable
 * move. Anything else is discarded so the caller falls back to the library.
 */
export function parseMoveResponse(text: string, candidates: MoveTemplate[]): MoveSpec | null {
  const raw = extractJson(text) as RawMove | null
  if (!raw) return null

  const title = asString(raw.title)
  const goal = asString(raw.goal)
  if (!title || !goal) return null

  const requestedId = asString(raw.id)
  const template =
    candidates.find((candidate) => candidate.id === requestedId) ??
    candidates.find((candidate) => candidate.id === requestedId?.split('.')[0])
  if (!template) return null

  const rawSeconds = typeof raw.timeLimitSec === 'number' ? raw.timeLimitSec : template.timeLimitSec
  const timeLimitSec = Math.max(30, Math.min(900, Math.round(rawSeconds)))

  const steps = Array.isArray(raw.steps)
    ? raw.steps.filter((step): step is string => typeof step === 'string').slice(0, 5)
    : template.steps

  const spec: MoveSpec = {
    id: template.id,
    title,
    why: asString(raw.why) ?? template.why,
    timeLimitSec,
    goal,
    steps,
    successCriteria: template.successCriteria,
    playbook: template.id.split('.')[0] ?? 'any',
    generatedBy: 'llm',
  }

  // Only a move that looks something up gets phrases, and only a few short ones.
  if (template.wantsMaterial) {
    const lookUp = asPhrases(raw.lookUp)
    if (lookUp.length > 0) spec.lookUp = lookUp
  }

  return spec
}

export interface GuidanceContext {
  blip: Blip
  move?: MoveSpec | null
  material?: { title: string; extract: string } | null
  /** What they have started writing, when asking from inside the move. */
  draft?: string
  /** Advice already given, so asking again gives something new. */
  previous?: string[]
}

/**
 * Ask for a short list of things to look for.
 *
 * Deliberately not "do the work for me": the answer is what to *watch for*, so the
 * person still has to look. The move, any material found for it, and anything they
 * have started writing all go in, so the list is about this specific thing.
 */
export function buildGuidancePrompt(ctx: GuidanceContext): { system: string; prompt: string } {
  const { blip, move, material, draft, previous } = ctx

  const system = [
    'You help someone know what to look for before they go and look.',
    'You do NOT do the work, answer their question, or write the note for them.',
    'Give between two and four items. Each is ONE short sentence of at most 20 words —',
    'a single thing to notice, compare or check.',
    'Each item must be specific to this material — never generic advice like "take notes".',
    previous && previous.length > 0
      ? 'They have already been given advice; give different, more specific angles.'
      : '',
    'Reply with JSON only.',
  ]
    .filter(Boolean)
    .join(' ')

  const entries = blip.entries
    .slice(-6)
    .map((entry) => `- ${entry.text ?? entry.url ?? ''}`)
    .join('\n')

  const prompt = [
    `TITLE: ${blip.title}`,
    blip.body && blip.body !== blip.title ? `BODY: ${blip.body}` : '',
    move ? `THE MOVE THEY ARE ABOUT TO DO: ${move.title} (goal: ${move.goal})` : '',
    material ? `WHAT THEY ARE ABOUT TO READ: ${material.title}\n${material.extract}` : '',
    entries ? `WHAT THEY HAVE WRITTEN SO FAR:\n${entries}` : '',
    draft?.trim() ? `WHAT THEY HAVE STARTED WRITING JUST NOW:\n${draft.trim()}` : '',
    previous && previous.length > 0
      ? `ADVICE THEY ALREADY HAVE:\n${previous.map((item) => `- ${item}`).join('\n')}`
      : '',
    draft?.trim() ? 'Build on what they have started; do not repeat it back to them.' : '',
    '',
    'Reply with exactly:',
    '{"items": ["...", "..."]}',
  ]
    .filter(Boolean)
    .join('\n')

  return { system, prompt }
}

/**
 * Pull a list of short items out of a model reply.
 *
 * Generous about length on purpose: a useful item that happens to run to 250
 * characters is worth keeping, and dropping it because of a limit is how this
 * silently returned nothing at all. Only an absurd one is trimmed.
 */
export function parseGuidance(text: string): string[] | null {
  const raw = extractJson(text) as { items?: unknown } | null
  const items = raw?.items
  if (!Array.isArray(items)) return null

  const cleaned = items
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= 600)
    .map((item) => (item.length > 320 ? `${item.slice(0, 317).trimEnd()}…` : item))
    .slice(0, 4)

  return cleaned.length > 0 ? cleaned : null
}

/** Never throws: without a model, or on any failure, there is simply no guidance. */
export async function requestGuidance(
  ctx: GuidanceContext,
  provider?: LLMProvider,
): Promise<{ items: string[]; generatedBy: 'llm' } | null> {
  if (!provider) return null
  try {
    if (!(await provider.available())) return null
    const { system, prompt } = buildGuidancePrompt(ctx)
    const items = parseGuidance(await provider.completeStructured({ system, prompt }))
    return items ? { items, generatedBy: 'llm' } : null
  } catch {
    return null
  }
}

export interface SelectMoveOptions {
  provider?: LLMProvider
  related?: Blip[]
}

/**
 * Choose a move. Prefers a model-adapted move, and falls back to the playbook on
 * any failure — no provider, no network, a bad reply, or a reply that picked a move
 * that is not on the menu.
 */
export async function selectMove(
  ctx: MoveContext,
  options: SelectMoveOptions = {},
): Promise<MoveSpec> {
  const candidates = candidateTemplates(ctx)
  const fallbackTemplate = candidates[0] ?? FALLBACK_TEMPLATE
  const fallback = toMoveSpec(fallbackTemplate)
  if (fallbackTemplate.wantsMaterial) fallback.lookUp = [deriveQuery(ctx.blip)]

  const provider = options.provider
  if (!provider) return fallback

  const full: MoveContext = { ...ctx, related: options.related ?? ctx.related }
  try {
    if (!(await provider.available())) return fallback
    const { system, prompt } = buildMovePrompt(full, candidates)
    const text = await provider.completeStructured({ system, prompt })
    const spec = parseMoveResponse(text, candidates)
    if (!spec) return fallback

    // A move that wants material must have a phrase to look up, even if the model
    // forgot one — the title is a perfectly good query.
    if (spec.lookUp === undefined) {
      const template = candidates.find((candidate) => candidate.id === spec.id)
      if (template?.wantsMaterial) spec.lookUp = [deriveQuery(ctx.blip)]
    }
    return spec
  } catch {
    return fallback
  }
}
