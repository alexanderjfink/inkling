# Inkling

*Make Moves on your Inklings.*

A local-first, mobile-first app for capturing, resurfacing, growing, and retiring
"blips of salience" — questions, references, insights, ideas, quests, yearnings —
without turning them into a guilty to-do list.

The design follows Andy Matuschak, *Towards scalable blip cultivation* (2024), and the
companion talk. Full plan: `~/.opencode/plan/blip-cultivation-mvp.md`.

## Status — the MVP, complete

| Piece | State |
|---|---|
| Event schema + `project()` fold | done, tested |
| Scheduler v1 (finite feed, no overdue term) | done, tested |
| Append-only local storage (IndexedDB, `durability: 'strict'`) | done |
| Capture — text / URL / image | done |
| Review loop — decision per blip, session receipt, sessions frozen | done |
| Retire / attic / revive | done |
| Sync — append-only log union, byte-offset watermarks, content-addressed blobs | done, tested |
| Handoff — a blip goes first in the queue, on any device | done |
| State digest — convergence check across devices | done, tested |
| **Moves** — a 22-move playbook, time-boxed, goal-bearing, no repeats | done, tested |
| **Models** — a provider registry: OpenCode Go by default, plus hosted and local | done, tested |
| **Related blips** — links, topics and wording first; embeddings optional | done, tested |
| **Contextual resurfacing** — a topic match overrides a snooze | done, tested |
| **URL fetch** — server-side, so a saved link has something to react to | done, tested |
| **Promotion** — ↑ on a blip writes an Obsidian note with specific next steps | done, tested |
| **Embeddings** — a separate provider, so vectors can come from a local model | done, tested |
| **Share target** — share a link or text from any app into Capture | done |
| **Voice** — 🎙 Ramble transcribes on the device | done |
| **Installable** — manifest, icons, service worker, offline shell | done |
| **Backups** — the log exports as the JSONL it already is, plus a readable Markdown one | done |
| **Accounts** — username, password, per-account settings and Inklings, an admin page | done |
| Storage engine | **decided**: IndexedDB (10.3k writes/s vs OPFS 806/s on the Android phone) |

## Layout

```
inkling/
├── packages/domain/   pure TypeScript core — no framework, no I/O
│   └── src/
│       ├── ids.ts        ULID-style sortable ids
│       ├── events.ts     the append-only event union + deterministic total order
│       ├── project.ts    fold(events) -> Blip[]
│       ├── schedule.ts   scoring + finite daily feed
│       ├── log.ts        JSONL wire format, idempotent merge
│       ├── hash.ts       sha256 (client and server share one implementation)
│       ├── digest.ts     state digest for convergence checks
│       ├── moves.ts      the playbook, selection, prompt and reply validation
│       ├── related.ts    how blips relate: links, topics, wording, embeddings
│       ├── obsidian.ts   note rendering, and drafting the next steps
│       └── llm.ts        the provider seam (nothing model-shaped lives elsewhere)
├── server/            Bun + file-backed store; sync, model proxy, url fetch
│   └── src/
│       ├── store.ts      append-only logs, content-addressed blobs, digests
│       ├── handler.ts    the HTTP API
│       ├── providerConfig.ts  presets, and where credentials come from
│       ├── provider.ts   OpenAI-compatible + Anthropic transports
│       ├── fetchPage.ts  url -> title + excerpt, with private-network guards
│       ├── vault.ts      writing notes into the Obsidian vault, path-guarded
│       └── index.ts      entry point
└── apps/pwa/          React 19 + Vite + Tailwind, installable PWA
    └── src/
        ├── storage/      StorageAdapter + AppendOnlyLog (IndexedDB), blobs
        ├── sync/         SyncTransport (HTTP) + Syncer
        ├── llm/          ProxyProvider — the client's view of the model
        ├── embeddings.ts cached vectors, by content hash
        ├── state/        useInkling(), useSync(), useRelated(), usePromote()
        ├── screens/      Home, Add, Review, AllBlips, Settings
        └── spike/        in-app storage benchmark
```

Everything in `packages/domain` is pure and framework-free, so the same core runs on
the server, on the desktop, and in the browser. The server imports it directly, so
client and server can never disagree about the log format.

## Getting it running

One command runs everything:

```bash
bun run dev      # the server on :8787, and the app on :5173
```

Open the app at **https://localhost:5173** (accept the certificate once).

**To use it for real** — on your phone, with no dev server — build the app and let the
server serve it, so the app and the API share one origin:

```bash
bun run build && bun run server
```

Then open **http://localhost:8787** on this machine. From the phone, `tailscale serve`
gives that a real certificate, or `adb reverse tcp:8787 tcp:8787` makes it
`http://localhost:8787` on the phone itself.

### What do I set as the "server"?

The URL of the Inkling server. **`/api` is the right answer** whenever the app and the
server share an origin — which they do in both setups above — so in practice you never
need to change it.

You would only set something else if the app is served from somewhere the server is
not, and then Settings says so and offers the address to use. The field exists for
that case, not as a step you are expected to complete.

## Commands

```bash
bun run dev                        # server + app together (the usual one)
bun run server                     # just the sync server, on :8787
bun run dev:pwa                    # just the app, on :5173
bun test                           # domain + server unit tests
bun run typecheck                  # all packages
bun run check                      # biome
bun run build                      # build the app the server serves
```

## Try it

1. **Add a blip** — text, a URL, an image, or ramble into the microphone.
2. **Review** — one blip at a time. Add an entry, promote it to a note, or put it down
   for a while. Clearing the queue shows what you did: *nothing lost*.
3. **Settings** — server, model, reminders, backup, storage.
4. **All blips** (from the bottom of Home) — everything, including the attic, where you
   can revive what you let go of.

## Sync

The server is what syncs your blips between devices, and where the model and the
vault live. The app keeps working without it — captures go to the device either way —
but sync, moves and promotion need it.

Run it, then open the app on two devices and watch a blip cross.

```bash
bun run server        # http://localhost:8787, and it serves the app too
```

The PWA talks to `/api`. That is simply correct now: the server serves the built app
from the same origin, so there is no proxy, no CORS and no mixed content. (In dev the
Vite server proxies `/api` to the same place, so it is correct there too.)

**On the phone**, the app reaches the server through the Vite proxy too, so nothing
extra is needed. For a server that is *not* your laptop (and for an installed PWA),
`tailscale serve` is the right answer — it gives a real HTTPS certificate on the
tailnet:

```bash
tailscale serve --bg 8787
# then set the Sync server URL to https://<machine>.<tailnet>.ts.net
```

Why this is conflict-free: each device writes only to its own log
(`logs/<deviceId>.jsonl`), events are identified by `deviceId:seq`, and the server
refuses to let a device write anyone else's log. Sync is therefore a set-union of
append-only files — there is no merge, and replaying is always safe. After each pass
the app publishes a digest of its folded state; when every device's digest matches,
you know for certain they agree.

## Moves

A move is a scaffolded microtask: time-boxed, low-energy, with a concrete goal, doable
on a phone in one sitting. The playbook in `packages/domain/src/moves.ts` holds around
35 of them across the six blip types — "set a 2-minute timer and ramble about how this
came up", "what would have to be true for this to be false?", "argue the opposite for
two minutes", "do the ugliest possible first version".

**Most moves send you somewhere to look.** The paper's complaint about naive resurfacing
is that it shows you the same blank prompt again; new material is the fix. So a move
carries one to three places to look, and the model supplies *search phrases*, never URLs —
a hallucinated link looks like an answer, whereas a search phrase simply finds nothing if
it is wrong.

Each phrase is then resolved into a link the server can vouch for, and the link says which
kind it is:

| | |
|---|---|
| **a page** | a real article, found and checked to be about the thing. It also brings back something to read |
| **a search** | "go and look". Used when no single page is the right answer — and for a phrase like *best starter MIDI keyboard*, no single page should be |

That second kind is the point of the distinction. Pretending an encyclopaedia article is
the answer to "what should I buy" would be worse than saying "go and look":

```
where to look
┌──────────────────────────────────────────────────────────┐
│ MIDI keyboard                                       page │
├──────────────────────────────────────────────────────────┤
│ search for “best starter MIDI keyboard for a phone… search│
└──────────────────────────────────────────────────────────┘
```

The phrases are resolved together rather than in turn, and the search URL lives in the
domain rather than on the server, so a move still sends you somewhere when the server is
unreachable.

When a phrase does land on a page, the server resolves it against Wikipedia, which needs
no key:

```
a move, if you want one
Find who first worked out why the sky is blue, and why
goal: One sentence: who it was, and what they were trying to explain
3 min · adapted                        not this one
┌──────────────────────────────────────────────────────────┐
│ Diffuse sky radiation — Solar radiation reaching the     │
│ Earth's surface. The blue of the sky comes from Rayleigh │
│ scattering: the gases in the air scatter short           │
│ wavelengths far more strongly than long ones.            │
└──────────────────────────────────────────────────────────┘
```

If nothing turns up, the move still works and says so — naming the phrase it searched, so
an absence is explainable rather than mysterious.

**And then the answer is checked.** Wikipedia's search is generous: give it five words
and it will find an article containing one of them. That is how *"social learning
platform"* returned **Piper Alpha**, an oil platform destroyed in 1988 — it matched on
"platform", and on "learning" from a paper cited in the article's references, and nothing
else in the phrase. *"social platform postmortem"* returned the article about a suicide,
which is worse than useless.

So a result is used only if Wikipedia's **own** match markers show that it matched two
words of the phrase, or one word of the title. Two, because one is what an unrelated page
looks like. This is deliberately blunt, and the costs are lopsided: showing nothing costs
almost nothing, while showing something unrelated costs your trust in every other
suggestion.

It still accepts a page whose title shares nothing with the query, which is the point:
*"why is the sky blue"* and *Diffuse sky radiation* have no words in common, and that is
the right answer. Wikipedia's ranking is followed rather than re-ranked — an earlier
attempt preferred title matches, which put a page ahead of it purely because one word of
the query happened to be in its title.

The division of labour is deliberate. **The model selects and adapts; it does not
invent.** A reply is only accepted if it picks a move that was actually on the menu,
produces a usable title and goal, and keeps a sane time limit — otherwise it is
discarded and the playbook answers instead. This is the source material's advice
taken literally: get the handcrafted version working first.

That means the model is a pure enhancement:

- **No key configured** → every move comes from the playbook. Nothing breaks.
- **Server unreachable** → same. The app is offline-first.
- **Model returns nonsense** → discarded, playbook answers.

To enable it, point the server at a provider. It defaults to **OpenCode Go** and
reuses the key OpenCode already has, so usually there is nothing to configure:

```bash
bun run server                    # uses OpenCode Go, key read from OpenCode's own store
INKLING_PROVIDER=ollama bun run server
INKLING_PROVIDER=openai OPENAI_API_KEY=sk-... bun run server
```

| Preset | Notes |
|---|---|
| `opencode-go` *(default)* | OpenCode Go. Key comes from OpenCode's own auth store |
| `opencode` | The OpenCode gateway |
| `openai`, `google`, `groq`, `openrouter` | The usual hosted providers |
| `anthropic` | Native API. **No embeddings**, so related blips use topics and links |
| `ollama` | `127.0.0.1:11434/v1` — local, no key needed |
| `vllm`, `lmstudio` | Local OpenAI-compatible servers |
| `custom` | Anything else: set `INKLING_BASE_URL` and `INKLING_MODEL` |

Overrides: `INKLING_BASE_URL`, `INKLING_MODEL`, `INKLING_EMBED_MODEL`, `INKLING_API_KEY`.
An explicit `INKLING_API_KEY` wins over anything else; otherwise the provider's own env
var is used; otherwise OpenCode's stored credential.

The key stays on the server; devices only ever talk to the proxy. Settings shows which
provider and model are in play, so it is never a mystery why a move says "from the
playbook".

## The interface

**The app opens on entry.** Not a menu, and not a dashboard: the assumption is that you
opened it because you noticed something, so the cursor is in the field and you can start
typing. There is no home screen — a screen whose only job is to ask which of two screens
you wanted is a screen you have to get past.

```
Inkling ──── ☺ ⇧ P ─┬─ ◷ Review · N waiting   the other thing you might have come to do
                    ├─ ⚙ Settings            friends, About, Admin
                    ├─ P You                 your picture, your colour, your password
                    └─ all N Inklings        everything, and the attic
```

Everything that belongs to the box — the paperclip, the type, the microphone, **Keep it** —
sits directly under it rather than at the bottom of the screen, so it is the thing beside
what you are writing rather than a toolbar you have to go looking for.

**Review sits above the field, not below it**, because with the keyboard up anything under
the field is gone. It carries a **preview of the first Inkling you would be shown**, so
you can decide whether now is the moment without opening it — and it only appears when
something is actually waiting, so the screen stays a place to write.

**The screen is centred on a phone**, as a group: the slogan, the Review card and the field
sit in the middle rather than all in the upper third with the keyboard over the rest. The
header stays at the top, because it is the one thing that should not move — and the slogan
lives with the centred group rather than in the header, where at 390px it truncated to "Make
Moves on your Inkli…", which is worse than not saying it.

The card for somebody waiting on you says **"priya wants your help"** — one person by name, or
*Friends want your help!* for more than one. It used to say "2 friends asked for a move", which
describes a queue rather than a person who is stuck.

**Entry opens as a button.** "What did you notice?" is a button, not a placeholder — it is an
invitation rather than a form, and tapping it opens the field with the cursor in it. That is
also the only way a phone will raise the keyboard, since it will not do it for a focus nobody
asked for. The line describing what can go in it sits *inside* the box until you have started
writing, and moves below it once the box has something in it. **"add structure" appears only
then too** — it used to be on an empty screen, asking about a shape for something that did
not exist.

It is one field. It takes words, a link, or a picture — pasted, dropped, or picked
with the paperclip — and works out what it was given rather than asking. **Structure goes in
the same box**: choose a checklist and a chip appears under what you are writing, marked *on
keep*, because it is part of what you are writing rather than a setting about it. It used to be three
boxes: one for the text, one for the address, one for the image. That asked you to decide
what you had noticed before you had written it down, and made the common case — writing a
sentence — look like paperwork.

A link in the text is found and kept as the link as well as the words, so a page shared as a
title and an address reads as both. A capture that is **nothing but** a link is titled by its
site rather than by the address, and tagged with it: `en.wikipedia.org` rather than
`https://en.wikipedia.org/wiki/Sourdough`, and `#wikipedia` rather than `#en` — a leading
two-letter label is a locale, not a name.

**The type scale is a step up, from the tokens rather than the call sites.** `--text-xs`
through `--text-xl` are redefined in `index.css`, so a label is 13px instead of 11 and a
caption is 15 instead of 12 — and the next thing added is the right size without anyone
remembering to make it so. The old 9–11px arbitrary sizes across the app were folded into the
smallest named step in the same pass. The smallest text on a screen you read at arm's length
was too small to read; that is a token problem, not a per-component one.

**Dark mode's accent is lighter** — `#a48fff` rather than `#8f74ff`, 6.9:1 on the card instead
of 5.2:1. It is the colour of every label you are meant to press, and an accent nobody can
read is decoration. The faintest text went up with it, in both themes: `#6f6f7a` on white
rather than `#9797a2` at 2.9:1.

Alongside it: a type (`auto` by default, overrulable) and voice. `⌘↵` / `Ctrl+↵` keeps it.
Nothing blocks on the network, so a capture is never lost to a bad connection.

### Being shown how it works, and finding out later

Someone opening Inkling for the first time gets a five-step **walkthrough** that points at
the actual controls — the field, the button that keeps it, the Review card, Settings — with
a ring drawn around the real thing rather than a slideshow describing it. The dimming is
done by that ring's own shadow, so the highlighted control cannot end up hidden behind the
thing that is supposed to be dimming it, which is how these overlays usually break.

A step whose control is not on screen — Review only exists once something is waiting — is
shown as a centred card instead of being dropped, so the walkthrough is the same length for
everyone.

**Step four introduces the word "move"**, because everything else assumes it: the slogan, the
playbook, asking a friend. Nothing said it. The step where you first meet one is the place to
define it — a single small thing to do with an Inkling, a couple of minutes long, made out of
your own words rather than invented for you.

**It is only offered to an account that has never been used**, and that is decided from two
sources, because they cover opposite cases. A fresh device looking at an account whose
Inklings are on the server: they arrive during the first sync, but reach the local
projection a beat after sync reports itself finished, so counting them locally would still
say zero. A device that already holds them: its sync adds nothing, so the sync report says
zero however long the person has been using Inkling. Neither signal is sufficient alone,
and using only the local one is what greets every established account as brand new on a new
phone — the case the guard exists for.

It is per account *and* per device, because settings are not synced. That is fine, because
the other guard is what actually keeps it away from someone who already uses the app.

**Help** opens with **an example of each kind of thing you could put in** — a real Inkling and
a real playbook move for each of the six types — because the hardest part of starting is not
knowing what belongs in here, and "a question, a quest, a yearning" on its own does not answer
that. Every move shown is one the app can actually offer, so the promise is not about a
hypothetical.

It is the reference, reachable from `?` on the entry screen and from Settings, and it
is where the walkthrough lives once you have seen it: *Show me around* replays it, and it is
written for someone who has been using Inkling for a month and wants to know what a thing
actually does rather than for someone who has never seen it.

### The example Inkling

A new account arrives with one Inkling it did not write, marked **example**. It is a real
Inkling, written through the same door as any other — a `captured` event and a `moveSaved`
event — because what is being demonstrated is what happens *after* you notice something.
A separate demo mode would show a version of the app that does not exist and teach the
wrong thing.

Its move is written out rather than generated, so the example works before any model is
configured. That is the point: the first thing you meet in Review should be something you
cannot get wrong, and it should show you what a move looks like — including both kinds of
link — without anything being set up first.

It arrives with the walkthrough rather than before it, so someone who opens the app to write
something still finds an empty field. The card says what it is throughout, and there is a
way to remove it. `generatedBy` stays `playbook`, which is the truth: nobody's model wrote it.

### Feedback, and the dashboard

**feedback** sits in the footer of the entry screen and under the Review card, and in
Settings. Not only in Settings, because "where were you when it went wrong" is the first
question about any report — and answering it by having been in Settings is not an answer.

What you were doing is gathered automatically and **shown back before sending**: the screen,
the Inkling's title (never its text), the move that was on screen, the provider and model,
both build stamps, the viewport, and how much is in the log. A report box that silently
attaches information about you is a box people stop using, and the whole value here is that
people keep using it.

It is written to the same log as everything else, with a fresh id so the fold ignores it and
it never becomes an Inkling. That means it reaches the server with no second mechanism, and
cannot be lost by a failed request.

**Settings → Manage accounts** opens the dashboard, for admins:

```
HOW IT IS GOING
accounts        2   1 admin · 2 joined this week
devices seen    3
Inklings        4   0 example
 · in play      2   1 put down
 · in the attic 1
 · written      1   25%
 · abandoned    1   kept coming back, never written against
moves offered   1   0 done · 0 put down · 0 kept for later
 · marked bad   1   100%
```

Then the two lists worth a person's time: everything **marked bad**, with the reason, the
note, and the Inkling it was about; and everything **said about the app**, with the screen
and the move it came from.

**Abandoned is the number to watch.** Retiring is a decision and a perfectly good outcome;
this counts the Inklings that keep coming back and never get written against, which is what
a suggestion that does not fit looks like from the outside. Both ways of waving something
away count — "not this one" on the card, and putting it down for later — because the more
common way for something to quietly stop happening is the second.

It is all read from the logs on demand rather than from a running tally: the logs are the
only thing guaranteed to be there, and a counter beside them would be a second source of
truth free to disagree with the first. An account whose logs cannot be read is **named**
rather than quietly counted as empty.

**Review** shows a single Inkling and three actions, and nothing else competes with them:

| | |
|---|---|
**Four things in one row, and they are not equals.** *Generate*, *New Move* (write your own)
and *Ask a Friend* are centred, because they are the choice; **till Tuesday** — the deferral,
labelled with the day it picked, so "later" is never a date you cannot see — keeps to the right
edge of the row. The three centre in what is *left* rather than on the screen: at 390px there
is room for the three or for the row of four centred on the middle, not both, and centring on
the middle put "Ask a Friend" against "till Tuesday". **Export** is a quiet link underneath.

The row used to be five things where three were a question and two were an answer, and its
outer buttons were grey enough to read as disabled next to the one filled one. The three that
ask for something carry the accent now; only the one you press most is filled.

**The Wikipedia extract is behind a "read it."** It is four or five lines of somebody else's
prose — the most text on the card by a distance — and the title and description are enough to
decide whether to read it.

**Nothing is generated until you ask.** An Inkling opens with the row of ways to get a move
and no spinner — and while it is thinking, *nothing appears on the card at all*. There used to
be a line saying so, which grew the card by a line and then shrank it again: a blank space
appearing and leaving, on the Inkling, right where the move was about to be. The button
already says "thinking", and it is where you pressed.

**Asking closes the suggestion.** They are two ways of getting one answer, so the app's move
goes when you ask a person, and the two buttons come back for whenever the answer arrives.
Cancelling the ask brings it straight back — it is hidden, not thrown away.

**And a move you asked for is remembered, not regenerated.** Coming back to an Inkling asked
about earlier used to produce a *different* move: the request was keyed the same way, but the
first reply had been recorded as shown by then, so the model was told to avoid what it had
just offered. Reviewing through a list, that reads as a generation happening on its own every
time you reach a card you had already asked about. Both the move and the fact that you asked
are remembered for the session; a re-roll or a rejection still asks for something new,
because that is what those are for.

The only work the app does on its own is resolving a shown move's phrases against Wikipedia,
and that is cached for the session too: it used to refetch the same two pages every time the
same Inkling was opened. **Both put their next step in the
same place**: inside the card, above the actions. Asking used to open its composer under the
two buttons at the bottom of the screen, so the thing you had just started was somewhere
other than where the thing you might have started instead would have been. It used to start a model call on
open, so every card you glanced at cost a call and a few seconds of waiting, including the
ones you were about to put down and the ones you were going to ask a friend about anyway.
Two costs, and only one of them is money.

A move you **saved** still appears without asking, because you already asked for it once.

Once there is a suggestion, it sits above the three actions with a **Do this** button: it opens the same
composer, bound to that move, and records the move as done when you keep the result.
Under it: **save for later** (keeps that move and puts the Inkling down, so it returns
with the move you liked) and **help me with the next step** (a short list of what to
look for, specific to the move and to whatever material was found).

**Structure is added where you are writing**, not on the card you are reading: a button in
the field that starts an Inkling and in the field that adds to one. **And it is usable, not named** — choosing a checklist draws a real checklist in the
writing box that you can tick and add steps to before the Inkling exists. A checklist you
cannot tick is a drawing of a checklist, and the point of adding one while you write is to put
the parts down as you think of them. It is attached the moment the Inkling is made.

Two kinds are offered, because two of them are *shapes* — a checklist is parts to tick off, a
grid is variations side by side, and both arrange something you already have. Reading progress
and a poll are each about one specific thing and neither is a shape anybody reaches for
mid-sentence. They still render, and an Inkling that already has one keeps it.

Choosing one before capturing shows a chip while you write — *"Checklist ×"*, and *"it will be
added when you keep this"*. It used to record the choice and show nothing, so a working button
looked like a broken one. It used to be a section on
every card, with an underline and a line explaining what structure could be, on cards that had
none — which is a thing you do while thinking about what this is becoming, not something you
do to a card. The blocks themselves still live on the card, because that is where you tick
them.

**Entries take what came with them.** An entry was text and only text, so the things people
actually collect — a photograph of what they meant, a page they found — had nowhere to go after
the first capture. Now they take a link or a picture the same way the first capture does, and
the card shows everything written down in the order it was written rather than in two lists
where a picture and the sentence about it could end up apart.

The three windows at the top are **Today**, **Near Future** and **All**: what is due now, what
is coming back inside the week, and everything. *Near Future* is the one worth having — the
difference between "later this week" and "someday" is the difference between a review session
and a wish list, and it used to be visible only by reading each card's date. *All* used to sit
in that middle slot, which is not a thing anybody looks for at a glance.

The **tomorrow / a week / a month** buttons are gone from under the card. Nobody could say what
they were for: three buttons that did the same thing, differing only in a date the app is
better at choosing than you are. The ✓ says the date it picked, and that is the choice —
retiring covers "not for a long time".

**moves so far** lists what has been put in front of you and when — behind a tap, so
the card stays clean. Related Inklings are listed and open on tap.

**"this is bad" is a different signal from "not this one".** *Not this one* means *not at
the moment* and is not recorded. *This is bad* means the suggestion itself was wrong, and
it is kept — with a reason if you tap one, and with everything the model was working from:
the Inkling's type and title, its topics, how much had accumulated, which moves had
already been offered, and the related Inklings it was shown.

That context is the point. A rejection on its own says "wrong"; the context says wrong
*about what*, which is the only thing that can change the algorithm — and it is gone by
the time anyone looks, because the move history holds only what was offered, not what it
was offered for.

A rejected move is not offered again, and **the rejection goes into the prompt for the
next one** — so it is a correction rather than a reroll. The reason is treated as
instruction: *too vague* asks for something concrete, *too big* for something smaller,
*nothing to do with this* for the blip's own words. You can tap a reason, type your own,
or both; the two are stored separately because a category and a detail are different
things.

A new suggestion comes back for the *same* Inkling, because "this is bad" is a request for
a better one, not a reason to move on.

**Settings → Backup → Download bad suggestions** writes every one of them as JSONL, one
per line, ready to read.

*The first rejection collected immediately showed something: the topics extracted for that
Inkling were "behave", "different", "differently". Those drive relatedness and resurfacing,
so they are worth fixing on their own evidence.*

Text is **Markdown**: headings, lists, quotes, code, bold, links. It is rendered by a
small renderer that escapes first and only then applies markup, so a note cannot
inject anything. **edit** corrects the title and body, and each entry has an **×** to
remove it — both recorded as events, so the log stays append-only.

**structure** is where an Inkling changes shape. A question that turns out to be a
project gets a **checklist**; a link that turns out to be long gets a **reading
tracker**; a decision gets a **poll**; a set of variations gets a **grid** of images.
Each is a block, and blocks can be added, changed and removed — so the structure
follows what the blip becomes rather than the other way round. Images in a grid go
through the same content-addressed store as captured photos, so they sync too.

**An entry remembers what prompted it.** A move is a prompt, and the prompt is part of
the answer — "it is stages, not a single switch" means something different if the move
was *read one summary and keep one sentence* than if it was *collect three examples*.
Under each entry there is a quiet **context** toggle: your own words stay the first
thing you read and the only thing at full contrast, and one tap opens the move that
asked, what *help me with the next step* suggested, and what it found to read. It opens
on tap rather than on hover because the device this is mostly used on has no pointer.

The material and the guidance are stored **with the entry**, because nothing else in the
log has them: they were fetched and shown once and then thrown away. The move itself is
not duplicated — the entry carries its `moveId`, and the move history stays the one place
a move spec lives. The Markdown backup prints the whole thing as a blockquote, so the
context reads as surrounding rather than as something you wrote.

**retire** and **delete** are deliberately different words. Retiring means *not now*:
it goes to the attic, stays searchable, and can come back. Deleting means *not this*:
it leaves the app. Neither is a hard erase from the log, which is append-only — both
are tombstones, so nothing is ever really rewritten.

A **Today / All** toggle switches between the finite daily feed and everything you
have. **browse** opens the full list, where tapping an Inkling opens it here, focused,
whether or not it was due.

Home carries one small trust line: **"3 captured today — all saved."** A capture that
vanished silently is the failure this app exists to avoid, so the count is visible
rather than assumed.

## How people appear

Every account has a **colour**, and it is theirs — set in Settings → You, and nobody else can
change it. It is drawn with their initial wherever they appear: on a card asking for help, on
the button that says *Suggest a move for Priya*, on the move they sent you, in the friends
list. The point is that a suggestion you did not ask for is easier to take from a person you
can picture, and a name in grey capitals is not a person.

Left alone, the colour comes from the account id — stable, and different people get different
ones. **Not yet: a profile picture.** A colour and an initial carry the association, but a
photo is the obvious next step.

## Friends, and moves from them

The app's suggestions come from a playbook and a model. A friend is often better at seeing
the first move than either — they know you, and they know what you have already tried. So
the third source of a move is a person.

**It is on by default**, and the whole of it can be switched off in Settings. Each route on
the server is refused outright when it is: there is no safe half of this to leave on, since
every one of them either reads somebody else's attention or writes to it. Friendships are
kept when it is off, so turning it back on restores them.

### Adding one

By username, and **asked rather than assumed** — typing somebody's name must not be enough
to be shown what they have been noticing. They see the request the next time they open
Inkling, and nothing of yours is visible until they accept. Removing one takes away both
directions at once.

### Suggesting, for somebody else

Suggesting a move is deliberately the same three fields a move has always had — what they
should do, what done looks like, and how long it takes — plus somewhere to say why. Nothing
else: *"something to look up"* was a fourth box that asked a person to do the searching half of
the job the app does for a generated move, and nobody filled it in.

It is one component (`Suggest.tsx`) rather than two, because it is reachable from two places
now: answering somebody who asked, and suggesting something unprompted after looking at what a
friend has been noticing.

### Asking

**The way to friends is a button in the header**, on every screen, carrying the number of
people waiting on you — an ask to answer, or a request to accept. It used to be a quiet link
in the footer of one screen, which is where a thing goes to be not found, and the question
that proved it was somebody asking *how do I ask a friend for a move at all*.

**Ask from the move card**, right under the suggestion, as a button rather than a footnote.
That is the moment the question occurs to somebody: the move is not it, and there is a person
who might know better.

**The panel opens where you pressed the button**, not at the bottom of the screen. It used to
render in one fixed place, so pressing the button inside the card opened the composer
somewhere else entirely — which reads as the button having opened the wrong thing. It is a
component of its own now, rendered in whichever place was pressed, and it holds its own state
so the friend you picked and the note you are typing survive the card re-rendering.

When there is no suggestion on screen the button and its panel appear below the card instead,
so there is always exactly one way in and it is never below the fold.

Whatever you want to say about being stuck goes with it. The friend gets the Inkling's title, what it is, its topics, what has already
been written against it, and **what has already been suggested** — so they can think of
something the app did not, rather than repeating it.

Asking somebody is showing them, so an Inkling that is private cannot be asked about. The
server enforces that as well as the button: *private means private* has to be true of what
the server will pass on, not only of what a button will let you press.

### Answering

Everything a friend asked for lands in **Notifications**, where **the friend leads the card** —
their initial, their name, and *"asked for a move"* — followed by their Inkling, the context
above, their note, and **the action inside the same box**, under a rule. **Suggest a move for
Priya** says whose it is: the action used to be the words "suggest a move" underlined beside a
timestamp, findable only if you already knew it was there, and never saying who you would be
helping — and it sat *below* the card, belonging to no card in particular.

You suggest something: a title, a goal, how long it takes, and
optionally something to look up. That is the same shape a move has always had, because a
friend is making the same kind of thing.

You can also answer by browsing **their Inklings** from the Friends screen, without going via
the ask. Either way the question clears: an answer is matched both by the ask it names and by
*who it went to and which Inkling it was for*, because only the first of those routes knows
which ask it is answering. Matching by the recipient as well is what keeps it honest — two
friends can be asked about the same Inkling, and answering one of them is not answering the
other.

### What arrives

A move from a friend is written into your own log as an event, so it survives the server
going away and reaches your other devices like anything else. On the card it says **a move
from Sam**, carries their note, and its links are resolved like any other move's.

**It comes first until you have done something with it.** Not merely higher in the round:
it is due even if the Inkling has been put down for a month, because letting it sit behind
a deferral would be letting the scheduling quietly ignore the only part of this that
involves anybody else. The moment an entry is written against it, the boost stops and it
becomes an ordinary Inkling again.

### Saying something back

*Say thank you* on a friend's move, and *kudos* once it has worked. One line each, because
a note that takes as long to write as the move did is a note nobody sends.

### A friend, and what has passed between you

Tapping a friend opens their history: everything that has gone both ways, newest first, with
filters for *both ways*, *you → them* and *them → you*. Four kinds of thing are in it — asks in
either direction, moves suggested in either direction, and notes and thank-yous — and each one
says which it is and what it was about.

**It is read from this device's own log, not asked of the server.** That is what makes it
complete: every ask, every suggested move and every thank-you was written down here in both
directions when it happened, and the server only ever carried the messages. It survives the
server being unreachable, and it works for the things that never needed a network at all.

**An ask says whether it is still waiting** — one you sent until something comes back, one they
sent until something goes back. An answer counts whether it came from the ask in the
notifications list or from browsing their Inklings, because the match is on the Inkling as well
as on the ask. It has to: only one of those two ways knows which ask it is answering.

**Both directions are on by default.** A list of only what you asked for reads as an invoice;
the half where you helped them is what makes it a friendship.

**Thanking is one tap**, on anything they did for you — a move they suggested, and no form
asking what you are grateful for, because that is a form nobody fills in. It sends 🙏 with the
name of the move, and the entry says "thanked" afterwards rather than asking again.

**And the thank-yous you collect are counted in your own profile**, under *the help you have
given*. It is the one number in the app that is not about you getting through something: a
thank-you is another person saying that what you thought of was worth doing, and it is the only
reward here that comes from somebody else. Each friend's screen has the count both ways as
well, because a count each way is a record of the two of you and a count of what you are owed
is a score.

### Who can see what

Per Inkling, on its card: **private** or **friends**. What you noticed on Tuesday is not the
same as what you noticed on Friday, and one setting for both is a setting nobody can answer
honestly.

**Who can see it is answered with faces.** When it is shared, the faces of the friends who can
be shown it sit beside the switch, overlapping, ringed in the card's colour so a stack reads
as two people rather than one blur. The word had to be decoded; a row of faces is read. When it
is private there is nothing there at all — the absence is the message, and a row of greyed-out
faces would be saying something louder than the thing itself.

Settings decides what new Inklings *start* as — shared with friends, or private — and that
is decided when the Inkling is written rather than by the fold, because a preference applied
later would silently re-share things written under a different one. Everything written
before this existed is private.

## Related blips

Every blip is shown alongside the blips it relates to, with the reason stated —
"you linked them", "shared topic: change", "similar in meaning". Snoozed blips appear
here too, which is the point: they are the ones you would otherwise never see again.

Relatedness is **not** embedding-first, deliberately. The strongest signal is that you
said two blips are related; then that they share a topic you named; then similar
wording; and only then embeddings. That ordering matters because OpenCode Go and
Anthropic expose no embeddings at all, and related blips still have to work.

When embeddings *are* available they are cached locally by a hash of the blip's text,
so unchanged blips are never re-sent.

Typing a topic into the Today box — or advancing a blip with that topic — offers the
matching snoozed blips as "bring them in". Offered rather than injected, so the finite
list stays finite.

## Settings, and the model

Settings is tabs, because there is genuinely more than one kind of thing on it and a single
column of twelve sections is a screen you scroll past rather than read.

| | |
|---|---|
| **You** | your account, the theme, reminders |
| **Friends** | the social half, and who you can ask |
| **About** | help, feedback, the app and the build |
| **Admin** | how it is going, the model, and accounts — **admins only** |

**Two of them are reachable two different ways.** The face in the top right of the entry
screen opens **You** — your picture, your colour, your password — and the gear opens
**Settings**: friends, About, Admin. They are the same component drawn with different tabs
(`only`), because two screens that share everything except their headings are two things to
keep in step. The split is the point: *who you are* is not the same question as *how the app
behaves*, and the header had four identical circles and a wordmark being squeezed to fit
them.

**Sync and Notes are hidden for now.** Their sections are still there, still gated on the
same names, so bringing either back is one line in `TABS` in `Settings.tsx`. Two things
were moved rather than hidden with them: the build stamps now sit in **About**, because with
the server settings out of sight that is the only place a stale build can be noticed, and
the server address is still reachable at sign-in, which is where it is needed most — so
hiding Sync is not a dead end.

**Admin is a tab rather than a button**, and only an admin's screen has it at all: a member
sees no trace of it rather than a tab that refuses to open.

**The smiling face opens notifications**, and friends are one press further on, from the button
at the top of that screen. The two used to share one header button that opened whichever had
something in it, which meant the way to your friends moved depending on whether anybody had
asked you for anything.

**The model is not in there any more.** It moved to the admin screen, and it is now one
model for the whole server rather than one per account. That is the honest shape: it runs on
the server, it holds the keys, and every account is asking the same process. A per-account
copy of a server-wide fact was two places to change one thing, and it meant anybody with an
account could point the server at an address of their choosing.

Moving it does not lose an existing key. At startup, if the server has no model settings and
somebody's account does, they are lifted onto the server and deleted from the account — so
nobody has to find and re-paste a key because of a change they did not ask for.

The vault stays per account: a note goes into one person's folder, not everybody's.

## Writing a note out

**Promoting to a note is switched off for now** (`PROMOTE_ENABLED` in
`apps/pwa/src/features.ts`). Putting a file into somebody's vault is a promise about their
file system, and it needs the path to be right, the folder to exist and the naming to be
settled before it is worth making.

**Export to note** replaces it, and does everything up to the file: the note is rendered
exactly as it would have been written — frontmatter, what you collected, the moves, what it
links to — and then handed over. **Download** saves it, **Copy** puts it on the clipboard,
and **Share** opens the system share sheet with it as a real `.md` file, so a phone offers
Notes, Obsidian, Files or Messages.

Nothing is lost by turning promoting back on. The path is still here, the server route is
still there, the vault settings are still there, and the next steps are still drafted — the
only difference is who does the last step.

## Configuring it

Almost everything is editable from the app — Home → **⚙** — and takes effect
immediately, with no restart:

| | |
|---|---|
| **Theme** | light, dark, or match the system |
| **Server** | the server URL, and a sync now button |
| **Model** | provider, model, server address, API key, embedding provider, embedding model, embedding address, embedding key, similarity floor |
| **Notes** | the vault path, and the folder inside it |
| **Reminders** | the nudge toggle |
| **Backup** | download the log |
| **Storage** | the IndexedDB-vs-OPFS benchmark |

**A name that resolves to `127.0.0.1` cannot be used from the container.** Inside a
container, `127.0.0.1` is the container itself, not the machine running it. So an address
that works from the host fails from the container with nothing but "unable to connect".
This is not exotic: the public wildcards `*.localdomain.cloud` and `localhost.direct`
resolve to `127.0.0.1` on purpose, so a local service can have a real certificate, and
they are exactly what you reach for when putting Ollama behind HTTPS.

Point the name at the host, which leaves the certificate valid because the name does not
change:

```yaml
    extra_hosts:
      - "ollama.localdomain.cloud:host-gateway"   # or the host's address on your network
```

Inkling says so in the error when it happens, rather than leaving you with "unable to
connect" and no reason.

**A model that is not where the preset says.** The **model server address** field appears
when it is the thing you are likely to want: for the local runners (Ollama, oMLX, vLLM,
LM Studio), whose presets point at `127.0.0.1`, and for a custom endpoint, which has no
address of its own. Leave it empty to use the preset's own. A remote Ollama is just
`https://ollama.yourdomain.com/v1` in that field, with the provider set to Ollama.

The address actually in use is shown under the settings — *"calling https://…"* — and a
failure to load the models now says which URL it tried and what came back, rather than
only that it failed.

Saved settings override the server's environment, which still supplies anything the
settings do not mention. **Keys are write-only**: the server reports whether one is set
and never returns it, so nothing secret round-trips through the browser.

Under **Model**, the model fields are **real dropdowns**. The list is loaded
automatically from the saved provider, so once the endpoint and key are in place you
just pick one — OpenCode Go returns 40, oMLX returns 4. Each field also offers
*"type a model that is not listed"*, because local runners often serve something the
endpoint does not advertise.

Alongside them:

| | |
|---|---|
| **Test model** | one real round trip, reported with its latency and the reply |
| **Test embeddings** | the same, for the embedding provider |
| **reload the list** | re-asks the provider, after changing provider or key |

They act on what is saved, so save before testing.

The same things can still be set with environment variables, and
`INKLING_PROVIDER=ollama bun run server` remains the quickest way to try one out.

## Promoting to a note

When a blip has accumulated enough, **Promote to note** ends the ambiguity: it drafts
specific next steps, renders an evergreen note, and writes it into your Obsidian vault.

The blip then moves to the **attic**, beside the retired ones — it has left the feed
either way. It keeps a link to its note and can be revived, and re-promoting writes
back to the same note rather than leaving a second one beside it.

The order matters. Steps are drafted *before* the note is rendered, because a note
without specific next steps has only moved the problem — the source material's
complaint about blips is that they "lack clear next steps". The `promoted` event is
appended only once the file is on disk, so a failed write leaves the blip untouched.

The note is mdbase-shaped on purpose — a `type` plus typed fields — so the same
renderer can feed a typed Markdown collection later without the formats diverging.

```yaml
---
type: evergreen
blip_id: 01J8ZQ4M7XK2V9BN3TPR6WD5YH
blip_type: question
title: "Why does rereading feel like learning?"
created: 2026-01-14
promoted: 2026-01-14
tags:
  - blip/question
  - topic/memory
---

# Why does rereading feel like learning?

## Next steps
- [ ] Find one study comparing rereading against self-testing.
- [ ] Write the answer as a single sentence you would repeat to someone else.

## Context
Topics: memory, reading
Related:
- [[Testing yourself beats rereading]]
```

Configuration:

```bash
INKLING_VAULT=~/Documents/Notebook      # default
INKLING_VAULT_FOLDER=Inkling            # default; notes land here
```

Without a model the steps fall back to something honest rather than clever: it names
the obvious action if there is one (read the saved link), and otherwise says plainly
that the step is yours to define. The note still gets written.

## Installing it as an app

There is a manifest, a service worker, real icons, and a **share target**, so Inkling
installs as a standalone app on Android and can receive links straight from the share
sheet. The Sync tab reports whether the service worker is live.

**The catch, and it is a real one:** Chrome refuses to register a service worker on an
origin whose certificate it does not trust. The dev server's self-signed certificate is
exactly that, so from `https://<lan-ip>:5173` the app runs but will not install and will
not work offline. The Sync tab says so explicitly rather than failing quietly.

Three ways to get a genuinely installable app:

```bash
# 1. localhost is trusted, so this needs no certificate at all
adb reverse tcp:5173 tcp:5173        # then open http://localhost:5173 on the phone

# 2. a real certificate on the tailnet
tailscale serve --bg 5173

# 3. build it and serve it from anywhere with a proper certificate
bun run build
```

Once installed, sharing a link or a piece of text from any app lands in Capture with
the fields already filled.

**Voice capture** uses the browser's own speech recogniser, so nothing is uploaded:
tap **🎙 Ramble** and it transcribes as you talk. That suits the source material's
"set a timer for two minutes and ramble into the microphone" better than shipping audio
to a server.

It needs three things, and the button says which is missing:

1. **A browser that implements it** — Chrome on Android or desktop. Firefox does not,
   and Safari's support is partial.
2. **A secure context** — `https://`, or `http://localhost`. Plain `http://` on a LAN
   address is not one, so voice will not work there even in Chrome.
3. **Microphone permission**, asked the first time you tap it.

**Backups** are the log itself: **Download log (JSONL)** writes the bytes sync already
moves, so any device can re-ingest it and nothing about the format is app-specific.
**Download as Markdown** is the same data as something you could still read if Inkling
were gone — entries, structure, which checklist items were ticked, which moves you
actually did. Settings says when you last exported, because an escape hatch nobody
remembers to use is not one.

**Reminders** are honest about the platform: the web cannot wake itself in the
background, so the nudge arrives when you open the app with something waiting — not at
a time you choose. A scheduled reminder needs the native wrap.

## The Android app (Capacitor)

The PWA installs from Chrome and does almost everything. An APK exists for the two
things a web page cannot do: a **scheduled** notification (the browser cannot wake
itself), and the system **share sheet** without going through Chrome.

`apps/pwa/android/` is a generated Capacitor project, committed so it can be opened
and built. The scaffolding is done; the build is not:

```bash
cd apps/pwa
bun run cap:sync          # build the web app, copy it into the Android project
bun run cap:open          # open in Android Studio
bun run cap:apk           # or: gradlew assembleDebug → android/app/build/outputs/apk/debug/
```

**It has not been built here.** There is no Java runtime and no Android SDK on the
machine this was written on, so `./gradlew` stops at *"Unable to locate a Java
Runtime"*. Everything up to that point is done: the platform is added, the app id and
namespace are set (`app.inkling.mobile`), the web assets are copied in, and the
project is a normal Android project. What remains is a machine with a JDK and the SDK
(`local.properties` with `sdk.dir`), and then the plugins worth adding —
`@capacitor/local-notifications` and `@capacitor/share`.

### Two things the native build has to get right

**The server address must be absolute.** In a browser the app and the API are the same
origin, which is why opening the server's own address needs no configuration. In the
APK the app is served from the phone (`https://localhost`), so a relative `/api` would
point at the phone. Set it in Settings, or bake it in at build time:

```bash
VITE_INKLING_SERVER=https://your-machine.ts.net/api bun run build
```

The app detects this and says so rather than reporting a server that is "down".

**`androidScheme: 'https'`** in `capacitor.config.ts` makes the WebView origin a
*secure context*. Without it `crypto.subtle` is unavailable, and the log hashes image
blobs with it — capture would fail on the phone and work on the desktop.

### A Trusted Web Activity instead

A TWA is a thinner option: an APK that is a Chrome shell pointed at your server. No
rebuild when the web app changes, and it shares Chrome's storage. It needs a
`/.well-known/assetlinks.json` on the origin, which this server generates from
settings — **Home → ⚙ → Android app** — rather than keeping as a file that can drift:

```bash
keytool -list -v -keystore android.keystore -alias inkling   # get the SHA-256
```

## Testing on the phone

The app must run in a **secure context** on the device. On a plain `http://<LAN-IP>`
page the browser treats the page as insecure, so `crypto.subtle` (used to hash image
blobs) is unavailable and OPFS cannot be probed — the Spike tab would report nothing
useful. Two ways around it:

**A. HTTPS over the LAN (the default).** The dev server serves HTTPS with a
self-signed certificate. Open the *Network* URL Vite prints and accept the warning
once — Chrome → **Advanced** → **Proceed**:

```
https://<your-lan-ip>:5173
```

If you reach for `http://<your-lan-ip>:5173`, Chrome will try to upgrade it to HTTPS
and fail with *"This site can't provide a secure connection"* — that is the dev
server speaking HTTP under a browser that insists on TLS, not a broken build.

**B. `http://localhost` via `adb reverse` (no certificate, no warnings).** If you have
USB debugging:

```bash
adb reverse tcp:5173 tcp:5173
```

then open `http://localhost:5173` on the phone. `localhost` is already a secure
context, so everything works without a certificate.

Note: each origin (scheme + host + port) gets its own local datastore, so blips
captured under `http://localhost:5173` will not appear under `https://<lan-ip>:5173`.

## Signing in

**Signing in lands on the entry screen**, whichever screen you were last on. Signing out happens
*from* the You screen, so that was exactly where you were — and coming back to a profile page
you had already read, when you signed in to write something down, is a screen you have to get
past. Every account gets the same start.

## Going back

The back button and the Android back gesture go back a screen, because every screen pushes a
history entry. Without that the gesture leaves the app entirely — from a card you were reading
— and the entry screen is the one with nothing behind it.

On the entry screen it now does nothing at all. That is the screen you land on, so back there
was the app closing when you meant to dismiss a keyboard. It puts the guard entry back and
stays where it is.

## Voice

Two ways to ramble, and it picks whichever is available.

**The browser's own recogniser** transcribes as you talk, which is what a sofa wants. It is
not everywhere — Firefox has none of it, and some phones only in a language you are not
speaking — so it wins only when it exists, because it is instant and costs nothing.

**Otherwise the recording is sent.** The microphone writes to a file, the file goes to the
server, and the server asks a transcription model. Anywhere that speaks OpenAI's audio
endpoint works: Whisper, `whisper.cpp`, a Parakeet server on a spare GPU, a hosted service.
It is set up in **Settings → Admin**, next to the model, because it is the server's to
configure and it is usually a different machine from the one doing the thinking.

With neither, the microphone button says so and nothing else pretends to work.

**Ollama cannot do this, and that is why there was no whisper to choose.** Ollama serves chat
models; it has no audio endpoint at all, so asking it for a transcription model is asking the
wrong machine. The address field takes anything that speaks OpenAI's `/v1/audio/transcriptions`
— `whisper.cpp`'s server, faster-whisper, a Parakeet server — and the **load the models**
button beside the field asks *that* server what it can serve, which is where a whisper name
comes from. It reads the address you have saved, so put the address in first and then load the
list. Nothing answering there says which address was tried and what it means when a loopback
one cannot be reached, because a container cannot see the host's `127.0.0.1`.

## Admin

**Settings → Admin** is the admin screen, and it is in three parts: *how it is going*, the
*model*, and *accounts*. The old name — and the old place, a button at the top of the
settings screen — were both confusing, because most of what an admin wants to know is not
about accounts.

**How it is going** is read from everybody's logs on demand rather than from a running
tally, because the logs are the only thing guaranteed to be there and a counter beside them
would be a second source of truth free to disagree with the first. Accounts, devices,
Inklings by state, moves by outcome, events per day, and the social half: friendships, asks
sent, how many are still unanswered, moves from friends, notes between them. Then the two
lists worth a person's time — everything **marked bad** with its reason and note, and
everything **said about the app** with the screen and move it came from.

Two numbers to watch. **Abandoned** counts the Inklings that keep coming back and never get
written against, which is what a suggestion that does not fit looks like from the outside;
retiring is a decision and a good outcome, so it is not counted. And **unanswered asks**,
because a question nobody answered is somebody who asked for help and did not get it.

**Accounts** is the second part: adding people, changing passwords, roles, removal. It used
to be the whole screen, which was confusing — most of what an admin wants to know is not
about accounts.

## Accounts

The server has users. A user is a username and a password, and then **the settings screen
as it already was** — their model, their keys, their vault. Nothing about an account is a
second kind of thing.

The first account you create is the **admin**. The admin page (Settings → Account →
Manage accounts) adds people, deletes them, changes their passwords and makes them an
admin or not.

```
data/
  auth/
    users.json          usernames, roles, argon2id hashes
    sessions.json       token hashes and expiry
  users/
    <id>/
      logs/             this person's Inklings, one file per device
      blobs/            their images, by content hash
      digests/          convergence checks
      config.json       their model, keys and vault
  config.json           server-wide: the TWA package name and fingerprint
```

**Everything is per account.** Two people on one server cannot see each other's Inklings,
cannot read each other's logs by guessing a device id, and do not share a model key. The
local database in the browser is per account too — signing out and in as someone else on
the same laptop opens their store, not the previous person's.

**Passwords** are argon2id via Bun, never stored in the clear and never returned over
HTTP. **Session tokens** are stored as SHA-256, so a copy of `sessions.json` is not a
copy of anyone's live session. Signing in answers the same way for a wrong password and
an unknown username, so the response cannot be used to find out who has an account.

**Sessions are bearer tokens, not cookies.** The Android build is served from the device
while the server is elsewhere, and a cookie there would be a third-party cookie and
dropped. The token lives in `localStorage`, which means script on the page can read it —
fine for a self-hosted tool on your own network, not fine in general.

**The first-run window.** Before any account exists, the first person to reach the server
can claim the admin. On Tailscale that is you. To close the window entirely, set
`INKLING_ADMIN_USER` and `INKLING_ADMIN_PASSWORD` so the account exists before the server
is reachable.

**Nothing is a hard delete.** Deleting an account removes the login and its sessions; the
Inklings stay in `data/users/<id>/` and the admin page says where. The last admin cannot
be deleted or demoted, and you cannot delete yourself — either would lock the server with
no way back in short of editing files by hand.

## Running it somewhere always on

Everything that makes two devices agree already lives on the server: the accounts, the
append-only logs, the content-addressed blobs, and the model settings. None of that needs
a second *device* to be awake — it needs the **server** to be awake. So the whole answer
to "how do I use this on my phone and my laptop for real" is: run the server on something
always on, and open its address on both.

There is a `Dockerfile` and a `docker-compose.yml` for exactly that. The whole thing, in
order:

```bash
# 1. Get the code onto the always-on machine, and put your data where the container
#    will find it. This is the same directory the dev server uses, so if you are
#    moving an existing setup, copy it rather than starting empty.
git clone <your-repo> inkling && cd inkling
mkdir -p server/data
rsync -a --delete ~/path/to/old/inkling/server/data/ server/data/

# 2. Build and start. The container serves the app and the API on one origin.
docker compose up -d --build

# 3. Give it a real certificate, so the phone can install it and so image capture
#    works (the browser only exposes crypto.subtle in a secure context).
tailscale serve --bg 12838
```

Then open the `https://<machine>.<tailnet>.ts.net` address Tailscale prints, on both
devices, and sign in. Because the server serves the built app itself, there is **nothing
to configure on either device**: `/api` is relative, so the app you loaded is already
talking to the server you got it from. Accounts, keys and Inklings are simply there, on
both.

**The data is a plain directory**, `server/data`, bind-mounted into the container. That
is deliberate: seeding the server is an ordinary `rsync`, backing it up is a copy of a
folder you can see, and nothing needs `docker cp`. Point it elsewhere with
`INKLING_DATA_DIR` if the repo is not where you want the data to live.

```bash
INKLING_DATA_DIR=/volume1/inkling docker compose up -d
```

**To update:** `git pull && docker compose up -d --build`. Your data is untouched, since
it lives outside the image.

**To check it is up:** `curl -s localhost:12838/api/health`. The container also has a
healthcheck, so `docker compose ps` shows whether it is healthy.

### Behind a reverse proxy

There is a working config in `deploy/nginx.conf.example`. **Inkling needs almost nothing
from the proxy** — it serves the app and the API on one origin, `/api` is relative, and
nothing in the server reads `X-Forwarded-*` or the `Host` header. Point the proxy at the
port and it works.

Three things will bite you, and only the first is really about Inkling:

**`client_max_body_size`.** nginx defaults to **1 MB**. Image capture uploads the whole
file as one blob, so a phone photo is rejected with a 413 before Inkling sees it, and the
app reports a failed capture — which looks like a bug in Inkling. Set it to something
like `64m`. Inkling itself imposes no limit; verified by pushing an 8 MB blob straight at
it.

**Timeouts.** A move asks a model, and a slow one takes longer than nginx's 60-second
default. When it does, the card sits on "choosing a move…" and gives up, which reads as
the model being broken. `proxy_read_timeout 180s`.

**Where the proxy is, and which port.** The compose file publishes the container's 8787
on the host's **12838**, bound to `127.0.0.1`. The left number is the host's; the right one
is the container's and does not need to change. That gives two different upstreams, and
mixing them up is the usual mistake:

| nginx runs | upstream |
|---|---|
| on the same host | `http://127.0.0.1:12838` |
| in Docker, on the same network | `http://inkling:8787` |
| on another machine | the host's address, with `INKLING_BIND=0.0.0.0` |

**`http://inkling:12838` does not work**, and it is worth knowing why: nothing listens on
12838 inside the container. That number exists only on the host, as a door into 8787.

If nginx is in Docker, put both on one network — two compose projects do not share one by
default:

```bash
docker network create inkling        # then attach both containers to it
```

With nginx on that network the published port is not needed at all, and dropping it keeps
12838 off the host entirely. If nginx is on another machine it cannot see `127.0.0.1`:

```bash
INKLING_BIND=0.0.0.0 docker compose up -d
```

**If your proxy insists on an `https://` upstream**, the container can speak TLS itself:

```yaml
    volumes:
      - ./certs:/certs:ro
    environment:
      - INKLING_TLS_CERT=/certs/fullchain.pem
      - INKLING_TLS_KEY=/certs/privkey.pem
```

Off by default, because terminating TLS in the container means managing the certificate
there too. nginx terminating it and talking plain http to Inkling is simpler and is what
the example config does.

### Two things to know

**The vault has to move too, or promotion stops working.** "Promote to note" writes into
your Obsidian vault, and on a remote server the vault is the server that does the writing.
`~/Documents/Notebook` on your laptop does not exist on the NAS, so the mount is the whole
fix:

```yaml
    volumes:
      - /volume1/Notebook:/vault      # the folder your notes already sync to
```

then set the vault to `/vault` in Settings, per account. If you use Syncthing already,
point it at the same folder and the notes land back on your laptop as usual.

Leave it out and **everything still works except promotion** — the app says plainly that
it could not write, rather than failing quietly. That is a reasonable way to start.

**Accounts are described in their own section**, including the one window worth knowing
about: on a server with no accounts yet, the first person to reach it becomes the admin.
Set `INKLING_ADMIN_USER` and `INKLING_ADMIN_PASSWORD` to close that window, or create the
account before the port is reachable.

### Why not put the data in mdbase instead

A fair question, and the answer is that mdbase and Inkling's sync are shaped differently
in the way that matters most.

mdbase is **records**: a Markdown file with a type, a current value for each field, and a
folder marker that makes it a collection. That is a good shape for notes and tasks. It is
not the shape of an append-only log — and the log is exactly what lets two devices agree
without conflict resolution. Each device only ever appends, so merging is a union, and
the worst case is doing something twice rather than losing it.

Storing Inklings as mdbase records would mean deciding what a record *is* (the Inkling's
current state?) and then re-solving the problem the log does not have: two devices editing
the same record. That is a rewrite of the one layer that is already tested and
conflict-free by construction, for no capability gained.

Where mdbase does fit is the other direction, and it is a small, real step: **the promoted
notes**. Those already are typed Markdown records in a folder, with frontmatter. Making
the vault an mdbase collection with a `blip` type — so the mdbase editor or TaskNotes
could read what Inkling promoted — costs nothing and touches no sync code. Worth doing;
just not as the backbone.

## Not yet

A native shell that *builds*. The Capacitor project is scaffolded and committed, but
`./gradlew` needs a JDK and the Android SDK, neither of which is on the machine this
was written on — so the APK itself is unbuilt. Everything before the Gradle step is
done and checked: the platform is added, the app id is set, the web assets copy in, and
the app knows how to behave natively (absolute server address, no service worker).

**The container image has not been built** either, for the same reason — no Docker
here. What *has* been verified is the behaviour a container depends on: the server
starts from an empty data directory with no keys, no `~/.local/share/opencode` auth
file and no vault, still serves the app, still works without a model, and accepts
settings at runtime that take effect with no restart.

**No password reset by email.** There is no email here, so a forgotten password is an
admin setting a new one for you. The last admin cannot be deleted or demoted, because
that would lock the server with no way back in short of editing files by hand.

**Deleting an account keeps its data.** It removes the login and the sessions; the
Inklings stay in `data/users/<id>/` and the admin page says so. One tap should not be
able to destroy years of someone's notes.

**Scheduled notifications** still need the native build. The nudge arrives when you open
the app, not at a time you choose, because the web cannot wake itself.
