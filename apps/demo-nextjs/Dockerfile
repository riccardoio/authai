# syntax=docker/dockerfile:1.7
#
# AuthAI Next.js SSR demo — production image. Modeled on
# apps/cloud-web/Dockerfile.
#
# Build context is the monorepo root (Dokku is told via
# `dokku builder-dockerfile:set authai-nextjs-demo dockerfile-path
# apps/demo-nextjs/Dockerfile`).

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
COPY apps/demo-nextjs/package.json           apps/demo-nextjs/package.json

RUN pnpm install --frozen-lockfile \
    --filter demo-nextjs... \
    --filter @authai-io/react... \
    --filter @authai-io/server...

# ---------------------------------------------------------------------------

FROM node:22-alpine AS builder

RUN corepack enable
WORKDIR /repo

COPY --from=deps /repo/node_modules     ./node_modules
COPY --from=deps /repo/packages         ./packages
COPY --from=deps /repo/apps             ./apps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

# Source for the workspace packages the demo imports + the demo itself.
COPY packages/react   packages/react
COPY packages/server  packages/server
COPY apps/demo-nextjs apps/demo-nextjs

# Next.js standalone build. transpilePackages handles the workspace TS
# packages at bundle time (no separate `pnpm --filter @authai-io/react build`
# needed — see apps/demo-nextjs/next.config.mjs).
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter demo-nextjs build

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runtime

WORKDIR /app

# Next.js standalone output: server.js + trimmed node_modules.
COPY --from=builder /repo/apps/demo-nextjs/.next/standalone ./
COPY --from=builder /repo/apps/demo-nextjs/.next/static    ./apps/demo-nextjs/.next/static

WORKDIR /app/apps/demo-nextjs

ENV NODE_ENV=production
ENV PORT=5000
ENV HOSTNAME=0.0.0.0

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://localhost:5000/ || exit 1

CMD ["node", "server.js"]
