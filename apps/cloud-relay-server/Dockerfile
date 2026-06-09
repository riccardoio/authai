# syntax=docker/dockerfile:1.7
#
# Cloud relay (Hono) production image. Multi-stage:
#
#   1) builder — installs the full pnpm workspace (just the deps for
#      @authai-io/cloud-relay-server and its transitive workspace pkgs)
#      and compiles the TypeScript packages this app uses.
#   2) runtime — minimal Node 22 alpine, copies only what's needed to run.
#
# Build context is the monorepo root. Dokku is told which Dockerfile to
# use via `dokku builder-dockerfile:set authai-relay dockerfile-path
# apps/cloud-relay-server/Dockerfile` so this file's paths are all
# repo-root-relative.

FROM node:22-alpine AS builder

# pnpm is pinned to the workspace's declared version in package.json's
# packageManager field — corepack handles that automatically.
RUN corepack enable

WORKDIR /repo

# Copy lockfile + workspace manifests first so a no-source change can hit
# Docker's layer cache and skip the install.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# All workspace package.json files (lightweight; lets pnpm see the
# workspace topology even though we haven't copied src yet).
COPY packages/relay/package.json                packages/relay/package.json
COPY packages/relay-store-sqlite/package.json   packages/relay-store-sqlite/package.json
COPY packages/relay-store-postgres/package.json packages/relay-store-postgres/package.json
COPY packages/cloud/package.json                packages/cloud/package.json
COPY packages/cli/package.json                  packages/cli/package.json
COPY packages/server/package.json               packages/server/package.json
COPY packages/react/package.json                packages/react/package.json
COPY apps/cloud-relay-server/package.json       apps/cloud-relay-server/package.json
COPY apps/relay-server/package.json             apps/relay-server/package.json
COPY apps/cloud-web/package.json                apps/cloud-web/package.json
COPY apps/demo-react/package.json            apps/demo-react/package.json
COPY apps/demo-backend/package.json          apps/demo-backend/package.json

# Install ONLY the deps needed for the relay app + its workspace deps.
# --frozen-lockfile fails fast if pnpm-lock.yaml is stale.
RUN pnpm install --frozen-lockfile \
    --filter @authai-io/cloud-relay-server... \
    --filter @authai-io/relay-store-postgres...

# Now copy the actual source for the packages we need.
COPY packages/relay                packages/relay
COPY packages/relay-store-postgres packages/relay-store-postgres
COPY packages/cloud                packages/cloud
COPY apps/cloud-relay-server       apps/cloud-relay-server

# Compile TypeScript for everything in the dependency tree. The relay
# app itself runs via tsx at runtime, so building it isn't strictly
# required — but building the workspace deps catches type errors early.
RUN pnpm --filter @authai-io/relay build \
 && pnpm --filter @authai-io/relay-store-postgres build \
 && pnpm --filter @authai-io/cloud build

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runtime

# tsx runs the relay's entrypoint TS directly. Slimmer than a separate
# build step + start-from-dist; the app is small enough that the runtime
# transform cost is negligible.
RUN corepack enable

WORKDIR /app

# Pull just what's needed from the builder. node_modules contains the
# hoisted + per-pkg deps installed during the build stage.
COPY --from=builder /repo /app

ENV NODE_ENV=production
ENV AUTH_AI_PORT=5000

# Dokku's nginx-vhosts plugin auto-detects the EXPOSE'd port and routes
# to it. Keep this in sync with AUTH_AI_PORT above.
EXPOSE 5000

# Healthcheck against /healthz (registered before tenantMiddleware so it
# works without any DB lookup). Dokku has its own checks plugin, but the
# Docker-level healthcheck is useful for direct `docker ps` debugging.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://localhost:5000/healthz || exit 1

CMD ["pnpm", "--filter", "@authai-io/cloud-relay-server", "start"]
