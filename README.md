# Inkling

*Help yourself make progress on your inklings.*

A local-first, mobile-first app for capturing, resurfacing, growing, and retiring
"blips of salience" — questions, references, insights, ideas, quests, yearnings —
without turning them into a guilty to-do list.

The design follows Andy Matuschak, *Towards scalable blip cultivation* (2024), and the
companion talk. Full plan: `~/.opencode/plan/blip-cultivation-mvp.md`.

## Status — M0 (Foundations)

| Piece | State |
|---|---|
| Event schema + `project()` fold | done, tested |
| Scheduler v1 (finite feed, no overdue term) | done, tested |
| Append-only local storage (IndexedDB + content-addressed blobs, `durability: 'strict'`) | done |
| Capture — text / URL / image | done |
| Review loop — decision per blip, session receipt, sessions frozen | done |
| Retire / attic / revive, send-to-desktop flag | done |
| Storage engine | **decided**: IndexedDB (10.3k writes/s vs OPFS 806/s on the Android phone) |
| `server/` (sync + LLM proxy) | not started — M2 |

The sync-ready layout is already in place (`deviceId`, per-event `seq`, append-only
writes), so the M2 sync milestone adds transport, not a data migration.

## Layout

```
inkling/
├── packages/domain/   pure TypeScript core — no framework, no I/O
│   └── src/
│       ├── ids.ts        ULID-style sortable ids
│       ├── events.ts     the append-only event union + deterministic total order
│       ├── project.ts    fold(events) -> Blip[]
│       └── schedule.ts   scoring + finite daily feed
└── apps/pwa/          React 19 + Vite + Tailwind, installable PWA
    └── src/
        ├── storage/      StorageAdapter + AppendOnlyLog (IndexedDB), blobs
        ├── state/        useInkling() — events in, blips + actions out
        ├── components/   Capture, Feed, AllBlips
        └── spike/        in-app storage benchmark
```

Everything in `packages/domain` is pure and framework-free, so the same core can run
on desktop, in an Obsidian plugin, or behind a server later.

## Commands

```bash
bun install
bun run dev                        # PWA dev server, reachable over the LAN
bun test                           # domain unit tests
bun run typecheck                  # both packages
bun run check                      # biome
bun run build                      # production build
```

## Try it

Open the app, then:

1. **Capture** a few things you noticed — text, a URL, an image.
2. **Today** gives a finite feed. Add a note, not now, send to desktop, or retire —
   each blip resolves to a decision, and clearing the list shows a receipt.
3. **All** shows Active / Snoozed / Attic, with Revive in the attic.
4. **Spike** measures IndexedDB vs OPFS. Run it *on the Android phone* — it decides
   the storage engine.

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

Sync (M2), moves + LLM (M3), related blips (M4), Obsidian export (M5), Capacitor
wrap, notifications, and voice capture (M6).
