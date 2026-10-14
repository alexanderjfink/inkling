# Inkling

*Help yourself make progress on your inklings.*

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
| **Backups** — the log exports as the JSONL it already is | done |
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
on a phone in one sitting. The playbook in `packages/domain/src/moves.ts` holds 22 of
them across the six blip types — "set a 2-minute timer and ramble about how this came
up", "find two counterexamples", "name the smallest version of this".

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

Three screens, and two of them are the only things you do.

```
Home ─┬─ Add a blip    text, a link, a photo, or your voice
      ├─ Review        one blip at a time, full screen
      └─ ⚙ Settings    sync, model, notes, reminders, backup, storage
```

**Review** shows a single blip and three actions, and nothing else competes with them:

| | |
|---|---|
| **↑ Promote to note** | drafts next steps and writes the note into your vault. The blip is done |
| **＋ Add entry** | write something down, with the suggested move as the prompt |
| **✓ until Saturday** | put it down; the label is the date it comes back |

A **Today / All** toggle at the top switches between the finite daily feed and
everything you have — same ordering, same three actions, no cap. **browse** opens the
full list, where tapping a blip opens it here, focused, whether or not it was due.
Retiring is a quiet link below — or *revive*, if you opened something out of the
attic. There is no separate desktop mode: the same three screens run on both devices,
and sync keeps them the same.

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

## Configuring it

Almost everything is editable from the app — Home → **⚙** — and takes effect
immediately, with no restart:

| | |
|---|---|
| **Sync** | the server URL, and a sync now button |
| **Model** | provider, model, API key, embedding provider, embedding model, embedding key, similarity floor |
| **Notes** | the vault path, and the folder inside it |
| **Reminders** | the nudge toggle |
| **Backup** | download the log |
| **Storage** | the IndexedDB-vs-OPFS benchmark |

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

The order matters. Steps are drafted *before* the note is rendered, because a note
without specific next steps has only moved the problem — the source material's
complaint about blips is that they "lack clear next steps". The `promoted` event is
appended only once the file is on disk, so a failed write leaves the blip untouched.

The note is mdbase-shaped on purpose — a `type` plus typed fields — so the same
renderer can feed a typed Markdown collection later without the formats diverging.

```yaml
---
type: evergreen
blip_id: 01M4XNBE96YQQZ8R4TPA1R35ST
blip_type: idea
title: "Stages of change theory interventions…"
created: 2026-10-14
promoted: 2026-10-14
tags:
  - blip/idea
  - topic/change
---

# Stages of change theory interventions, and how they fit spaced repetition

## Next steps
- [ ] Send Gena a direct message listing three specific questions about …
- [ ] Draw a six-row table mapping each stage of change to a card objective.

## Context
Topics: change, interventions
Related:
- [[Ask Gena about stages of change theory]]
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

**Backups** are the log itself: **Download log** in the Sync tab writes the JSONL that
sync already moves, so any device can re-ingest it and nothing about the format is
app-specific.

**Reminders** are honest about the platform: the web cannot wake itself in the
background, so the nudge arrives when you open the app with something waiting — not at
a time you choose. A scheduled reminder needs the native wrap.

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

## Not yet

A native shell. Everything M6 set out to fix — share-sheet capture, offline, an
installed app, voice, backups — is now done as a PWA, because that is verifiable on
this machine and covers the same ground on Android. A Capacitor wrap is still the way
to get *scheduled* notifications and a real app-store presence, and it needs a native
toolchain (no Android SDK here) plus a trusted certificate.
