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

**Some moves bring you something to read.** The paper's complaint about naive
resurfacing is that it shows you the same blank prompt again; new material is the fix.
For those moves the model supplies a *search phrase*, never a URL — a hallucinated link
looks like an answer, whereas a search phrase simply finds nothing if it is wrong. The
server resolves it against Wikipedia, which needs no key:

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

Three screens, and two of them are the only things you do.

```
Home ─┬─ Add an Inkling   a photo, a link, an idea, a question, or a quest (⌘↵ / Ctrl+↵ to keep it)
      ├─ Review          one Inkling at a time, full screen
      └─ ⚙ Settings      theme, sync, model, notes, reminders, backup, storage
```

**Review** shows a single Inkling and three actions, and nothing else competes with them:

| | |
|---|---|
| **↑ Promote to note** | drafts next steps and writes the note into your vault. The Inkling is done |
| **＋ Add entry** | write something down, free-form |
| **✓ until Saturday** | put it down; the label is the date it comes back |

A suggested **move** sits above them with a **Do this** button: it opens the same
composer, bound to that move, and records the move as done when you keep the result.
Under it: **save for later** (keeps that move and puts the Inkling down, so it returns
with the move you liked) and **help me with the next step** (a short list of what to
look for, specific to the move and to whatever material was found).

**moves so far** lists what has been put in front of you and when — behind a tap, so
the card stays clean. Related Inklings are listed and open on tap.

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
