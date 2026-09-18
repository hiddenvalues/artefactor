# syntax=docker/dockerfile:1

# ---- build stage ----------------------------------------------------------
FROM node:26-bookworm-slim AS build
WORKDIR /app

# Toolchain for compiling better-sqlite3's native addon.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# node:26 no longer bundles corepack; install pnpm (the devEngines packageManager) directly.
RUN npm install -g pnpm@11

# Install deps, then approve native build scripts (better-sqlite3, esbuild)
# non-interactively so the SQLite addon is compiled.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile && pnpm approve-builds --all

COPY . .
RUN pnpm build
# Drop dev dependencies but keep the compiled native modules. `CI=true` is what
# tells pnpm 11 it may purge node_modules unattended (without it the build stops
# at ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY).
RUN CI=true pnpm prune --prod

# ---- runtime stage --------------------------------------------------------
FROM node:26-bookworm-slim AS runtime
WORKDIR /app

# curl: used by the container healthcheck (Coolify probes GET /health from
#   *inside* the container, and bookworm-slim ships no curl/wget by default).
# gosu: drop from root to the unprivileged `node` user in the entrypoint after
#   fixing /data ownership (see docker-entrypoint.sh).
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl gosu \
  && rm -rf /var/lib/apt/lists/*

# Stamp the build commit (passed by CI as --build-arg GIT_SHA=<sha>); surfaced at
# GET /health so a deploy can be confirmed against the shipped commit.
ARG GIT_SHA=dev

ENV NODE_ENV=production \
    PORT=3000 \
    GIT_SHA=${GIT_SHA} \
    DATABASE_PATH=/data/artefactor.db \
    ARTEFACTOR_PAYLOAD_DIR=/data/payloads \
    ARTEFACTOR_THUMBNAIL_DIR=/data/thumbnails \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CLIENT_DIR=/app/dist/client \
    MIGRATIONS_DIR=/app/migrations \
    AUTHORING_GUIDE_PATH=/app/skills/artefactor/SKILL.md

COPY --from=build /app/node_modules ./node_modules
# S35 — headless Chromium (plus its system libraries) for artefact card
# thumbnails. Installed as root into PLAYWRIGHT_BROWSERS_PATH and left readable
# by everyone, so the unprivileged `node` user can launch it. Dormant unless
# ARTEFACTOR_THUMBNAILS=on (deliberately not set here: rendering stays opt-in
# until renderer isolation lands). Without it cards show the kind placeholder.
RUN node node_modules/playwright-core/cli.js install --with-deps chromium-headless-shell \
  && rm -rf /var/lib/apt/lists/* \
  && chmod -R a+rX /ms-playwright
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/infra/db/migrations ./migrations
# The authoring skill is served at runtime by the MCP `get_authoring_guide` tool
# (S18) — it is NOT bundled into dist, so it must be copied into the image.
COPY --from=build /app/skills ./skills
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# SQLite DB file, artefact payloads and thumbnails must live on a persistent
# volume (Coolify); the entrypoint's `chown -R /data` covers all three.
VOLUME ["/data"]
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
