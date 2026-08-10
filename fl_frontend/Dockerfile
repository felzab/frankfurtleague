# Stage 1: Base -> Setup OS deps and package manager
FROM node:26-alpine3.24 AS base
ARG PNPM_VERSION=11.18.0

# libc6-compat for Alpine's native C binaries (SWC, image optimization); tini for PID 1 signal
# routing -> the container shuts down gracefully.
RUN apk add --no-cache libc6-compat tini
RUN npm install -g pnpm@${PNPM_VERSION}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV NEXT_TELEMETRY_DISABLED=1
# pnpm prompts interactively without it, and nothing here can answer.
ENV CI=true

# Stage 2: Deps -> Isolate dependency resolution
FROM base AS deps
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

# Stage 3: Builder -> Compile app
FROM base AS builder
WORKDIR /app

# This stage has no .env, so the startup gate would reject every variable and the build would die on
# the first module that reads config. The schema is still enforced by local.sh and on every deploy.
ENV SKIP_ENV_VALIDATION=true
# Needed even with validation skipped: fl_frontend/src/core/db.ts constructs a MongoClient at module
# scope, and `new MongoClient(undefined)` throws.
ENV MONGODB_URI=mongodb://localhost:27017/placeholder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
    pnpm run build

# Stage 4: Runner -> Runtime environment
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
