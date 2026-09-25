# syntax=docker/dockerfile:1
# Needs BuildKit (the default builder in current Docker and in buildx): the
# runtime stage's Chromium step uses `RUN --mount`.

# ---- deps stage -----------------------------------------------------------
# Only the package manifests, so this stage — and the Chromium layer that
# bind-mounts it below — is rebuilt when the lockfile changes, not per commit.
FROM node:26-bookworm-slim AS deps
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

# ---- build stage ----------------------------------------------------------
FROM deps AS build
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

ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/artefactor.db \
    ARTEFACTOR_PAYLOAD_DIR=/data/payloads \
    ARTEFACTOR_THUMBNAIL_DIR=/data/thumbnails \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    CLIENT_DIR=/app/dist/client \
    MIGRATIONS_DIR=/app/migrations \
    AUTHORING_GUIDE_PATH=/app/skills/artefactor/SKILL.md

# S35/S37 — headless Chromium (plus its system libraries) for artefact card
# thumbnails. Installed as root into PLAYWRIGHT_BROWSERS_PATH and left readable
# by everyone, so the unprivileged renderer user can launch it. It is used
# **only** by the renderer role (ARTEFACTOR_ROLE=renderer, AH29): the app role
# never starts a browser, and points at the renderer with ARTEFACTOR_RENDERER_URL.
# Without a renderer, cards show the kind placeholder.
# This ~600 MB layer sits before every `COPY --from=build` and before
# `ARG GIT_SHA`, and runs playwright-core from a bind mount of the `deps` stage
# (which copies nothing into the layer), so its cache key is the base image plus
# the lockfile only: the build stage's node_modules changes on every build
# (`pnpm prune` stamps its state files), and GIT_SHA on every commit.
RUN --mount=type=bind,from=deps,source=/app/node_modules,target=/tmp/deps \
    node /tmp/deps/playwright-core/cli.js install --with-deps chromium-headless-shell \
  && rm -rf /var/lib/apt/lists/* \
  && chmod -R a+rX /ms-playwright

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/infra/db/migrations ./migrations
# The authoring skill is served at runtime by the MCP `get_authoring_guide` tool
# (S18) — it is NOT bundled into dist, so it must be copied into the image.
COPY --from=build /app/skills ./skills
COPY --from=build /app/package.json ./package.json
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

# Stamp the build commit (passed by CI as --build-arg GIT_SHA=<sha>); surfaced at
# GET /health so a deploy can be confirmed against the shipped commit. It comes
# after the last RUN: an ARG in scope keys every later RUN's cache, and this one
# changes on every commit.
ARG GIT_SHA=dev
ENV GIT_SHA=${GIT_SHA}

# The SQLite DB file, artefact payloads and thumbnails must live on a persistent
# volume mounted at /data (Coolify: an explicit named volume); the entrypoint's
# `chown -R /data` covers all three. Deliberately **no** `VOLUME` instruction
# (S37, AH29): it would hand every container from this image — the renderer
# included — an anonymous writable volume that survives restarts, and a renderer
# must carry no state at all.
EXPOSE 3000

ENTRYPOINT ["./docker-entrypoint.sh"]
