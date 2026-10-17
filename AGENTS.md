# Working on Inkling

Notes for whoever is changing this next — human or agent. They are here because the slow part
of the last few sessions was not the code, and not the commands either.

## Start here

```sh
bun run probe          # a dev stack you can drive, and keep
```

That prints the app URL, the API, the data directory and an account. Open the app URL, sign in
**once**, and the session stays: the token lives in the browser and the data lives in `.probe/`,
which is never the real thing and never in git. Reloading the page is all a change needs.

```sh
bun run verify         # biome, three typechecks, every test, and a build
```

Run `verify` when you are about to commit. **Not after every edit.** It takes ten seconds, but
the command is not what costs — the round trip is, and there is no reason to spend one per edit.

## The number that matters

Measured, so nobody has to guess:

| | |
|---|---|
| `biome check` | 0.2 s |
| three typechecks | 2 s |
| 566 tests | 6 s |
| `vite build` | 2 s |

Ten seconds for the whole gate. So when a change takes five minutes, it is not the tooling: it
is the number of round trips, and how much each one carries. Prefer fewer, larger calls; batch
independent shell work into one; and keep the browser out of the loop until a question needs it.

## The loop

1. `bun run probe` — once per working session.
2. Sign in — once.
3. Change a file, then reload the page. No build is needed: the dev server compiles on request.
4. Look at the thing you changed, not the whole app.
5. `bun run verify` when you are done, then commit.

**Prefer the built server only when the built server is the question** (a service worker, the
build stamp, the Docker image). For anything about layout or behaviour, the dev server is the
same app and skips a step.

## Traps that have actually cost time here

- **Anchors written from memory fail.** Biome reindents the file after every edit, so the text
  you remember is often not the text that is there. `grep -n` for the line, `sed -n` the region,
  and only then write the replacement. Several edits in one session were lost this way, each
  costing two or three round trips to recover.
- **Never edit by line number.** Two attempts at removing a block took out the wrong one because
  the anchor was "the third `</div>`"; anchor on text that appears once, and let it fail loudly.
- **Poll, do not sleep.** `sleep 12` is either too short or twelve seconds too long. Loop on the
  thing you are waiting for: `until curl -sf localhost:8787/api/health; do sleep 0.2; done`.
- **The 390px viewport is the binding constraint.** Rows that fit on a laptop do not fit on a
  phone, and the failure looks like a collision, not an overflow. Read the element bounds from a
  snapshot instead of judging a screenshot — they show it before it is visible to the eye.
- **Screenshots are expensive and usually unnecessary.** A snapshot scoped to one `selector`
  answers "is it there, and what shape is it" for a fraction of the context. Capture an image
  when the question is genuinely visual.
- **Never let a keyframe hold the only visible state.** `animation-fill-mode: both` with
  `opacity: 0` in the first keyframe means a browser that decides not to run the animation —
  a background tab, a headless viewer, a reduced-motion setting — leaves the element at
  "invisible". A green disc with nothing on it, three times in one session, while the DOM
  happily reported a white check in the middle of it. Make the element's own state the
  finished state and let the animation only decorate.
- **A screenshot can be older than the DOM.** `browser.inspect` said the glyph was white, 72px,
  visible, in the right place; the capture showed an empty disc. When an image and an inspect
  disagree, believe the inspect and change what you are checking, rather than re-running the
  image.
- **When something is meant to last a second and a half, look at it with a longer hold first.**
  A model round trip is longer than the animation. Pin it open or raise the constant, look,
  then put it back — and say in the commit that you did.
- **Tests carry the logic; the browser carries the truth about the browser.** Anything in
  `packages/domain` — folds, schedules, parsing, timelines — belongs in a test, where it runs in
  milliseconds and cannot be misread. Layout, focus, gestures and the service worker belong in
  the browser. Do not check arithmetic by tapping through the UI.

## What is where

```
packages/domain     the fold, the schedule, moves, timelines — pure, and where the tests live
server/src          the API, accounts, the postbox between friends, the vault
apps/pwa/src        the app: screens/, components/, state/
scripts/probe.ts    the development stack described above
```

`server/data/` is the real data on the real machine. `.probe/` is throwaway. Neither is in git,
and neither should ever be copied into the other.
