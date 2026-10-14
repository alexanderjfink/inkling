import { describe, expect, test } from 'bun:test'
import type { Blip, BlipEvent, BlipEventBody, LLMProvider } from '../src/index'
import {
  buildNextStepsPrompt,
  draftNextSteps,
  heuristicNextSteps,
  noteFilename,
  notePath,
  parseNextSteps,
  project,
  renderObsidianNote,
  slugify,
} from '../src/index'

let seq = 0
function ev(body: BlipEventBody, at: string): BlipEvent {
  seq += 1
  return { ...body, deviceId: 'test', seq, at }
}

function makeBlip(events: BlipEvent[]): Blip {
  const [blip] = project(events)
  if (!blip) throw new Error('expected a blip')
  return blip
}

function fakeProvider(behaviour: {
  text?: string
  throws?: boolean
  available?: boolean
}): LLMProvider {
  return {
    name: 'fake',
    available: async () => behaviour.available ?? true,
    completeStructured: async () => {
      if (behaviour.throws) throw new Error('boom')
      return behaviour.text ?? ''
    },
    embed: async () => [],
  }
}

const richBlip = () =>
  makeBlip([
    ev(
      {
        t: 'captured',
        id: 'b1',
        input: {
          kind: 'url',
          url: 'https://example.com/stages',
          text: 'look into stages of change theory',
        },
        type: 'reference',
        body: 'look into stages of change theory',
        topics: ['stages', 'change'],
      },
      '2026-01-01T09:00:00Z',
    ),
    ev(
      {
        t: 'entry',
        id: 'b1',
        entry: {
          id: 'e1',
          kind: 'note',
          text: 'interested in the interventions',
          at: '2026-01-02T09:00:00Z',
        },
      },
      '2026-01-02T09:00:00Z',
    ),
  ])

describe('slugify', () => {
  test('makes a filesystem-safe slug', () => {
    expect(slugify('What are my principles?')).toBe('what-are-my-principles')
    expect(slugify('  Stages of Change — Theory!  ')).toBe('stages-of-change-theory')
  })

  test('never returns an empty slug', () => {
    expect(slugify('!!!')).toBe('blip')
    expect(slugify('')).toBe('blip')
  })

  test('bounds the length', () => {
    expect(slugify('a'.repeat(200)).length).toBeLessThanOrEqual(48)
  })
})

describe('note naming', () => {
  test('filename is a slug plus a short id, so two blips never collide', () => {
    const blip = richBlip()
    const filename = noteFilename(blip)
    expect(filename.endsWith('.md')).toBe(true)
    expect(filename.startsWith('look-into-stages-of-change-theory')).toBe(true)
    expect(filename).toContain(blip.id.slice(-6).toLowerCase())
  })

  test('notePath joins the folder without doubling slashes', () => {
    const blip = richBlip()
    expect(notePath('Inkling', blip)).toBe(`Inkling/${noteFilename(blip)}`)
    expect(notePath('/Inkling/', blip)).toBe(`Inkling/${noteFilename(blip)}`)
    expect(notePath('', blip)).toBe(noteFilename(blip))
  })
})

describe('renderObsidianNote', () => {
  test('renders frontmatter, the body, collected entries, steps and context', () => {
    const blip = richBlip()
    const note = renderObsidianNote(blip, {
      nextSteps: ['Read the interventions section', 'Draft two paragraphs'],
      related: [
        makeBlip([
          ev(
            {
              t: 'captured',
              id: 'b2',
              input: { kind: 'text', text: 'spaced repetition for self-help books' },
              type: 'idea',
            },
            '2026-01-03T00:00:00Z',
          ),
        ]),
      ],
      now: new Date('2026-02-01T12:00:00Z'),
    })

    expect(note.startsWith('---\n')).toBe(true)
    expect(note).toContain('type: evergreen')
    expect(note).toContain(`blip_id: ${blip.id}`)
    expect(note).toContain('promoted: 2026-02-01')
    expect(note).toContain('  - blip/reference')
    expect(note).toContain('  - topic/stages')
    expect(note).toContain('source: https://example.com/stages')
    expect(note).toContain('# look into stages of change theory')
    expect(note).toContain('## What I collected')
    expect(note).toContain('interested in the interventions')
    expect(note).toContain('## Next steps')
    expect(note).toContain('- [ ] Read the interventions section')
    expect(note).toContain('## Context')
    expect(note).toContain('- [[spaced repetition for self-help books]]')
  })

  test('omits sections that would be empty', () => {
    const blip = makeBlip([
      ev(
        { t: 'captured', id: 'b3', input: { kind: 'text', text: 'a bare idea' }, type: 'idea' },
        '2026-01-01T00:00:00Z',
      ),
    ])
    const note = renderObsidianNote(blip, { nextSteps: ['Do the thing'] })
    expect(note).not.toContain('## What I collected')
    expect(note).not.toContain('## Context')
    expect(note).toContain('## Next steps')
  })

  test('always ends with a newline', () => {
    const blip = richBlip()
    expect(renderObsidianNote(blip, { nextSteps: ['x'] }).endsWith('\n')).toBe(true)
  })

  test('a question keeps its question mark, because that is the note', () => {
    const blip = makeBlip([
      ev(
        {
          t: 'captured',
          id: 'b4',
          input: { kind: 'text', text: 'What are my principles?' },
          type: 'question',
        },
        '2026-01-01T00:00:00Z',
      ),
    ])
    expect(renderObsidianNote(blip, { nextSteps: ['x'] })).toContain('# What are my principles?')
  })
})

describe('next steps', () => {
  test('parses a well-formed reply, tolerating fences and prose', () => {
    expect(parseNextSteps('{"steps":["one","two"]}')).toEqual(['one', 'two'])
    expect(parseNextSteps('Sure:\n```json\n{"steps":["one"]}\n```')).toEqual(['one'])
  })

  test('rejects junk, empties and absurd steps', () => {
    expect(parseNextSteps('no idea')).toBeNull()
    expect(parseNextSteps('{"steps":[]}')).toBeNull()
    expect(parseNextSteps('{"steps":["  "]}')).toBeNull()
    expect(parseNextSteps(JSON.stringify({ steps: ['ok', 'x'.repeat(400)] }))).toEqual(['ok'])
  })

  test('caps at three steps', () => {
    expect(parseNextSteps(JSON.stringify({ steps: ['a', 'b', 'c', 'd', 'e'] }))).toHaveLength(3)
  })

  test('the heuristic names the obvious action rather than inventing one', () => {
    const steps = heuristicNextSteps(richBlip())
    expect(steps[0]).toContain('https://example.com/stages')
    expect(steps.length).toBeGreaterThan(0)
  })

  test('the heuristic still says something for a bare blip', () => {
    const bare = makeBlip([
      ev(
        { t: 'captured', id: 'b5', input: { kind: 'text', text: 'a bare idea' }, type: 'idea' },
        '2026-01-01T00:00:00Z',
      ),
    ])
    expect(heuristicNextSteps(bare)).toEqual(['Write the next concrete action for this note.'])
  })

  test('draftNextSteps uses the model when it behaves', async () => {
    const draft = await draftNextSteps(richBlip(), {
      provider: fakeProvider({ text: '{"steps":["Ask Gena about the interventions"]}' }),
    })
    expect(draft.generatedBy).toBe('llm')
    expect(draft.steps).toEqual(['Ask Gena about the interventions'])
  })

  test('draftNextSteps falls back on no provider, a throw, or a bad reply', async () => {
    expect((await draftNextSteps(richBlip())).generatedBy).toBe('heuristic')
    expect(
      (await draftNextSteps(richBlip(), { provider: fakeProvider({ throws: true }) })).generatedBy,
    ).toBe('heuristic')
    expect(
      (await draftNextSteps(richBlip(), { provider: fakeProvider({ text: 'meh' }) })).generatedBy,
    ).toBe('heuristic')
    expect(
      (await draftNextSteps(richBlip(), { provider: fakeProvider({ available: false }) }))
        .generatedBy,
    ).toBe('heuristic')
  })

  test('the prompt asks for specific, actionable steps', () => {
    const { system, prompt } = buildNextStepsPrompt(richBlip())
    expect(system).toContain('specific')
    expect(system).toContain('Never write vague steps')
    expect(prompt).toContain('look into stages of change theory')
    expect(prompt).toContain('interested in the interventions')
    expect(prompt).toContain('"steps"')
  })
})
