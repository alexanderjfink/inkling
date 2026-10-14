# Inkling

*Help yourself make progress on your inklings.*

A local-first, mobile-first app for capturing, resurfacing, growing, and retiring
"blips of salience" — questions, references, insights, ideas, quests, yearnings —
without turning them into a guilty to-do list.

The design follows Andy Matuschak, *Towards scalable blip cultivation* (2024), and the
companion talk. Full plan: `~/.opencode/plan/blip-cultivation-mvp.md`.

## Status — M3 (Moves)

| Piece | State |
|---|---|
| Event schema + `project()` fold | done, tested |
| Scheduler v1 (finite feed, no overdue term) | done, tested |
| Append-only local storage (IndexedDB, `durability: 'strict'`) | done |
| Capture — text / URL / image | done |
| Review loop — decision per blip, session receipt, sessions frozen | done |
| Retire / attic / revive | done |
| Sync — append-only log union, byte-offset watermarks, content-addressed blobs | done, tested |
| Handoff — "send to desktop" → Desk view → action reflects back | done |
| State digest — convergence check across devices | done, tested |
| **Moves** — a 22-move playbook, time-boxed, goal-bearing, no repeats | done, tested |
| **Model** — OpenRouter behind a server proxy; the model *selects and adapts* | done, tested |
| **URL fetch** — server-side, so a saved link has something to react to | done, tested |
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
│       └── llm.ts        the provider seam (nothing model-shaped lives elsewhere)
├── server/            Bun + file-backed store; sync, model proxy, url fetch
│   └── src/
│       ├── store.ts      append-only logs, content-addressed blobs, digests
│       ├── handler.ts    the HTTP API
│       ├── llm.ts        OpenRouter, optional and unconfigured by default
│       ├── fetchPage.ts  url -> title + excerpt, with private-network guards
│       └── index.ts      entry point
└── apps/pwa/          React 19 + Vite + Tailwind, installable PWA
    └── src/
        ├── storage/      StorageAdapter + AppendOnlyLog (IndexedDB), blobs
        ├── sync/         SyncTransport (HTTP) + Syncer
        ├── llm/          ProxyProvider — the client's view of the model
        ├── state/        useInkling(), useSync()
        ├── components/   Capture, Feed, Desk, AllBlips, SyncPanel, MoveCard
        └── spike/        in-app storage benchmark
```

Everything in `packages/domain` is pure and framework-free, so the same core runs on
the server, on the desktop, and in the browser. The server imports it directly, so
client and server can never disagree about the log format.

## Commands

```bash
bun install
bun run server                     # sync server on :8787
bun run dev                        # PWA dev server (proxies /api -> :8787)
bun test                           # domain + server unit tests
bun run typecheck                  # all packages
bun run check                      # biome
bun run build                      # production build
```

## Try it

1. **Capture** a few things you noticed — text, a URL, an image.
2. **Today** gives a finite feed. Add a note, not now, send to desktop, or retire —
   each blip resolves to a decision, and clearing the list shows a receipt.
3. **Desk** holds the blips you sent over for a flow state, and acting there pushes
   the change back to the server.
4. **All** shows Active / Snoozed / Attic, with Revive in the attic.
5. **Sync** configures the server, runs a pass on demand, and reports the state digest.

## Sync

Run the server, then open the app on two devices and watch a blip cross.

```bash
bun run server        # http://localhost:8787
```

The PWA talks to `/api`, which the dev server proxies to `localhost:8787`. That is
deliberate: the app is served over HTTPS, so calling a plain-HTTP API directly would
be blocked as mixed content. Same-origin `/api` means the phone works with no extra
certificates. To point at a server elsewhere, set the URL in the Sync tab.

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

To enable it, give the server a key:

```bash
OPENROUTER_API_KEY=sk-or-... bun run server
# optional: INKLING_MODEL, INKLING_EMBED_MODEL, OPENROUTER_BASE_URL
```

The key stays on the server; devices only ever talk to the proxy. The Sync tab shows
whether a model is configured, so it is never a mystery why a move says "from the
playbook".

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

Related blips and embeddings (M4), Obsidian export (M5), Capacitor wrap, notifications,
and voice capture (M6).
