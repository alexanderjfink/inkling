import type { ReactNode } from 'react'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2 border-t border-line pt-5 first:border-t-0 first:pt-0">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="flex flex-col gap-2 text-sm leading-relaxed text-ink-soft">{children}</div>
    </section>
  )
}

/** A term and what it does, in the order you meet them on a card. */
function Row({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs font-semibold text-ink">{term}</span>
      <span>{children}</span>
    </div>
  )
}

/**
 * The reference, and the way back into the walkthrough.
 *
 * Written for someone who has been using it for a month and wants to know what a thing
 * actually does — not for someone who has never seen it, who gets the walkthrough instead.
 */
export function Help({ onStartTour }: { onStartTour: () => void }) {
  return (
    <div className="flex flex-1 flex-col gap-5 pb-8">
      <button
        type="button"
        onClick={onStartTour}
        className="card flex items-center gap-3 p-4 text-left transition active:scale-[0.99]"
      >
        <span className="circle circle--accent h-10 w-10 shrink-0 text-lg leading-none">?</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Show me around</span>
          <span className="block text-xs text-ink-soft">
            A short walkthrough of the screen you start on
          </span>
        </span>
      </button>

      <Section title="What Inkling is for">
        <p>
          It holds the things you notice and do not want to lose — a question, a photograph, half an
          idea, something someone said. The point is not to get through them. The point is to keep
          noticing, and to come back to what you noticed when it can actually do something.
        </p>
        <p>
          So nothing here is ever "overdue", and there is no backlog to clear. An Inkling that keeps
          being put down is telling you something, and putting it down is a perfectly good outcome.
        </p>
      </Section>

      <Section title="Noticing something">
        <p>
          The app opens on the entry field, because that is what you came to do. Type it in whatever
          words you have. Add a link or a photo if there is one. The type — a question, a quest, a
          yearning — is guessed for you, and you can overrule it.
        </p>
        <p>
          <span className="text-ink">Ramble</span> uses the microphone and writes down what you say
          as you say it, which is often the honest way to get at something you have not worked out
          yet. Nothing leaves the device to be captured, and a capture is never blocked on the
          network: if the server is unreachable, the Inkling is still kept and syncs when it can.
        </p>
      </Section>

      <Section title="Coming back to it">
        <p>
          Review shows one Inkling at a time, and only the ones that are due — a few a day at most,
          each a couple of minutes. You can leave at any point; the count is a session, not a debt.
        </p>
        <p>
          <span className="text-ink">not this one</span> moves on and leaves no trace. It simply was
          not the moment, and there is nothing to feel bad about.
        </p>
        <p>
          <span className="text-ink">this is bad</span> is a different signal: the suggestion itself
          was wrong. Tap a reason, say it in your own words, or both — and another move comes back
          for the same Inkling, chosen with what you said taken into account. These are kept, so the
          suggestions can be improved.
        </p>
      </Section>

      <Section title="Moves">
        <p>
          A move is one small thing to do with an Inkling, sized to a few minutes and always built
          from your own words rather than invented for you. A move that needs a fact looks it up
          first, and says so when it found nothing.
        </p>
        <p>
          <span className="text-ink">Do this</span> opens the composer bound to that move and
          records it as done when you keep the result.{' '}
          <span className="text-ink">help me with the next step</span> lists what to look for.{' '}
          <span className="text-ink">save for later</span> keeps the move and puts the Inkling down,
          so it comes back with the move you liked.
        </p>
        <p>Everything a move was working from stays attached to the entry you write.</p>
      </Section>

      <Section title="The three things you can do with an Inkling">
        <Row term="↑ Promote to note">
          Drafts next steps and writes a real note into your vault, then the Inkling is done. The
          next steps are concrete — a thing to try, a source to look at — not a restatement of the
          idea.
        </Row>
        <Row term="＋ Add entry">
          Write something down, free-form. This is how an Inkling grows: what you learned, what
          changed your mind, what you would try next.
        </Row>
        <Row term="✓ until …">
          Put it down. The label is the date it comes back, and the app works that out from how
          often you have put it down before — so something you keep deferring drifts away rather
          than nagging.
        </Row>
      </Section>

      <Section title="Letting something go">
        <p>
          <span className="text-ink">retire</span> means you have lost interest for now. It leaves
          the daily review and sits in the attic, and you can bring it back. Nothing is deleted.
        </p>
        <p>
          <span className="text-ink">delete</span> is different, and is meant to be. It takes the
          Inkling out of your way for good.
        </p>
      </Section>

      <Section title="Where your Inklings live">
        <p>
          On this device first, always, in a log that is only ever appended to. The server is a
          second copy, and sync merges the two — so a phone and a laptop end up with the same
          Inklings without either one being the master.
        </p>
        <p>
          Your account has its own settings and its own data. If the server is unreachable,
          everything still works except sync and moves.
        </p>
      </Section>

      <Section title="The keyboard">
        <Row term="⌘↵ or Ctrl+↵">Keep the Inkling you are writing.</Row>
        <Row term="Esc, ← →">Move through the walkthrough.</Row>
      </Section>

      <Section title="If something looks wrong">
        <p>
          Settings shows the version of the app and of the server, whether the model is reachable,
          and whether the server has seen your latest Inklings. When sync looks stuck, that is the
          first place to look.
        </p>
      </Section>
    </div>
  )
}
