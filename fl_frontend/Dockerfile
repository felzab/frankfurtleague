# Stage 1: Base -> the OS layer the build and the runtime share
FROM node:26-alpine3.24 AS base

# libc6-compat for Alpine's native C binaries (SWC while building, image optimization while
# serving); tini for PID 1 signal routing -> a stop signal reaches node, which exits on it
# without draining what is in flight (`docs/ops/spec.md`).
RUN apk add --no-cache libc6-compat tini

ENV NEXT_TELEMETRY_DISABLED=1

# Stage 2: Toolchain -> the package manager, for the stages that build
# It sits between base and the build stages so the runner inherits none of it: pnpm is 57 MB of
# installer no CMD invokes, and CI/PNPM_HOME are build-time answers that have no business in a
# production process environment.
FROM base AS toolchain
ARG PNPM_VERSION=11.18.0

RUN npm install -g pnpm@${PNPM_VERSION}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# pnpm prompts interactively without it, and nothing here can answer.
ENV CI=true

# Stage 3: Deps -> Isolate dependency resolution
FROM toolchain AS deps
WORKDIR /app

# Only what `pnpm fetch` reads (pnpm.io/cli/fetch): with package.json in this layer's key, renaming
# a script re-downloads every package.
COPY pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

# Stage 4: Builder -> Compile app
# FROM deps, never `COPY --from=deps` of node_modules: a second transfer on a cold build, and a
# second copy in what `mode=max` exports.
FROM deps AS builder

# This stage has no .env, so the startup gate would reject every variable and the build would die on
# the first module that reads config. The schema is still enforced by local.sh and on every deploy.
ENV SKIP_ENV_VALIDATION=true
# Needed even with validation skipped: fl_frontend/src/core/db.ts constructs a MongoClient at module
# scope, and `new MongoClient(undefined)` throws.
ENV MONGODB_URI=mongodb://localhost:27017/placeholder

COPY . .

RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
    pnpm run build

# Stage 5: Runner -> Runtime environment
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Next's standalone server binds localhost otherwise, which no other container can reach.
ENV HOSTNAME="0.0.0.0"

RUN addgroup -S --gid 1001 nodejs && \
    adduser -S --uid 1001 nextjs -G nodejs -s /sbin/nologin

# The prerender cache is written at run time, so .next must belong to the runtime user.
RUN mkdir .next && chown nextjs:nodejs .next

# public stays root-owned, so the running app cannot write to it.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000


CMD ["tini", "--", "node", "server.js"]
