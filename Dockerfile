# Inkling, in a container.
#
# One process serves the built app *and* the API on a single origin. That is what
# makes `/api` correct on every device with no per-device setup: open the address,
# and the app you are looking at is talking to the server you got it from.
#
# Everything stateful lives in /data — the log, the content-addressed blobs, and the
# model settings. Mount the Obsidian vault at /vault and promotion works too.

# --- build --------------------------------------------------------------------
FROM oven/bun:1 AS build
WORKDIR /app

# Manifests first, so editing source does not re-run the install.
COPY package.json bun.lock ./
COPY apps/pwa/package.json apps/pwa/
COPY packages/domain/package.json packages/domain/
COPY server/package.json server/
RUN bun install --frozen-lockfile

COPY . .
# Only the app needs building. The server runs its TypeScript directly under Bun,
# so there is no second build step and no compiled output to keep in step.
RUN bun run build

# --- run ----------------------------------------------------------------------
FROM oven/bun:1 AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8787 \
    INKLING_DATA=/data

# The whole workspace is copied rather than a trimmed production install: the server
# resolves `@inkling/domain` through the workspace link, and keeping that exactly as
# it was built is worth more than a smaller image on a machine you own.
COPY --from=build /app ./

RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD bun -e "const p=process.env.PORT??8787;const r=await fetch('http://127.0.0.1:'+p+'/api/health');process.exit(r.ok?0:1)"

CMD ["bun", "server/src/index.ts"]
