# syntax=docker/dockerfile:1.7
#
# Cloud webapp (Next.js) production image. Three-stage:
#
#   1) deps     — install pnpm workspace deps (cached on lockfile)
#   2) builder  — copy src + build Next.js with output: 'standalone'
#   3) runtime  — minimal Node, copies just the standalone output
#
# Build context is the monorepo root (Dokku is told via
# `dokku builder-dockerfile:set authai-web dockerfile-path
# apps/cloud-web/Dockerfile`).

FROM node:22-alpine AS deps

RUN corepack enable
WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# All workspace manifests so pnpm resolves the topology.
COPY packages/relay/package.json                packages/relay/package.json
COPY packages/relay-store-sqlite/package.json   packages/relay-store-sqlite/package.json
COPY packages/relay-store-postgres/package.json packages/relay-store-postgres/package.json
COPY packages/cloud/package.json                packages/cloud/package.json
COPY packages/cli/package.json                  packages/cli/package.json
COPY packages/server/package.json               packages/server/package.json
COPY packages/react/package.json                packages/react/package.json
COPY apps/cloud-web/package.json                apps/cloud-web/package.json
COPY apps/cloud-relay-server/package.json       apps/cloud-relay-server/package.json
COPY apps/relay-server/package.json             apps/relay-server/package.json
COPY apps/demo-react/package.json            apps/demo-react/package.json
COPY apps/demo-backend/package.json          apps/demo-backend/package.json

RUN pnpm install --frozen-lockfile \
    --filter @authai-io/cloud-web... \
    --filter @authai-io/relay-store-postgres... \
    --filter @authai-io/cloud...

# ---------------------------------------------------------------------------

FROM node:22-alpine AS builder

RUN corepack enable
WORKDIR /repo

# Bring node_modules + workspace symlinks from the deps stage.
COPY --from=deps /repo/node_modules     ./node_modules
COPY --from=deps /repo/packages         ./packages
COPY --from=deps /repo/apps             ./apps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Source for the workspace packages the webapp imports + the webapp itself.
COPY packages/relay                packages/relay
COPY packages/relay-store-postgres packages/relay-store-postgres
COPY packages/cloud                packages/cloud
COPY apps/cloud-web                apps/cloud-web
COPY docs                          docs

# Build the workspace TS packages first (Next.js needs them resolved as
# real .js or via transpilePackages — we configured transpilePackages but
# building catches type errors).
RUN pnpm --filter @authai-io/relay build \
 && pnpm --filter @authai-io/relay-store-postgres build \
 && pnpm --filter @authai-io/cloud build

# Next.js build (the `prebuild` script bakes docs/reference.md into
# src/lib/generated/reference-md.ts as part of this step).
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @authai-io/cloud-web build

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runtime

WORKDIR /app

# Next.js's standalone output is a self-contained Node app. We copy:
#   .next/standalone/  — the standalone server + its trimmed node_modules
#   .next/static/      — built static assets (not included in standalone)
#   public/            — the webapp's public/ assets (none today, but in
#                        case any get added later)
COPY --from=builder /repo/apps/cloud-web/.next/standalone ./
COPY --from=builder /repo/apps/cloud-web/.next/static    ./apps/cloud-web/.next/static
COPY --from=builder /repo/apps/cloud-web/public          ./apps/cloud-web/public

# `next start` in standalone mode is just `node server.js` from the
# project root, which Next places inside apps/cloud-web/.
WORKDIR /app/apps/cloud-web

ENV NODE_ENV=production
ENV PORT=5000
ENV HOSTNAME=0.0.0.0

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://localhost:5000/ || exit 1

CMD ["node", "server.js"]
