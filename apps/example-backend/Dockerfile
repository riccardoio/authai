# syntax=docker/dockerfile:1.7
#
# authai-demo image. Single container, single port. Hono process:
#
#   - serves the built Vite SPA from /public
#   - exposes /api/{me,models,chat} that proxy through the live
#     relay (relay.authai.io) using AUTH_AI_SECRET for tenant binding
#
# Build context is the monorepo root. Dokku is told which Dockerfile to
# use via `dokku builder-dockerfile:set authai-demo dockerfile-path
# apps/example-backend/Dockerfile` so this file's paths are all
# repo-root-relative.

FROM node:22-alpine AS builder

RUN corepack enable

WORKDIR /repo

# Copy lockfile + workspace manifests first so source-only changes can
# hit Docker's layer cache.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./

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
COPY apps/example-react/package.json            apps/example-react/package.json
COPY apps/example-backend/package.json          apps/example-backend/package.json

# Install deps for the demo only — example-backend (server) and
# example-react (SPA build). The `...` suffix pulls workspace deps too
# (@authai/server, @authai/react, react/react-dom, hono, openai).
RUN pnpm install --frozen-lockfile \
    --filter example-backend... \
    --filter example-react...

# Copy source for everything we'll touch during build/runtime.
COPY packages/server      packages/server
COPY packages/react       packages/react
COPY apps/example-backend apps/example-backend
COPY apps/example-react   apps/example-react

# Build the SPA. Both @authai/react and @authai/server publish their
# .ts source directly (no dist/), so Vite + tsx handle TypeScript at
# build/runtime — no separate compile step for those packages.
RUN pnpm --filter example-react build

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runtime

RUN corepack enable

WORKDIR /app

# Pull /repo wholesale — node_modules + source + the built SPA dist.
COPY --from=builder /repo /app

# example-backend's src/index.ts resolves SPA_DIST as
# `../public` from the file's directory (apps/example-backend/dist/
# would conflict with potential future tsc output). Symlink-by-rename
# the SPA's dist into apps/example-backend/public.
RUN mv /app/apps/example-react/dist /app/apps/example-backend/public

ENV NODE_ENV=production
ENV PORT=5000

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -q -O - http://localhost:5000/healthz || exit 1

CMD ["pnpm", "--filter", "example-backend", "start"]
