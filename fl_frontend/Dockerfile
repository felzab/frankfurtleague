# Stage 1: Base -> Setup OS deps and package manager
FROM node:26-alpine3.24 AS base
ARG PNPM_VERSION=11.10.0

# Alpine requires libc6-compat for native C binaries (e.g., SWC, image optimization)
# Install tini for proper PID 1 signal routing -> allows graceful shutdown
RUN apk add --no-cache libc6-compat tini
RUN npm install -g pnpm@${PNPM_VERSION}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# Disable NextJS telemetry
ENV NEXT_TELEMETRY_DISABLED=1
# Required by pnpm to bypass interactive prompts in Docker
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

# To prevent zod .env validation
ENV SKIP_ENV_VALIDATION=true
# To prevent crashes
ENV MONGODB_URI=mongodb://localhost:27017/placeholder

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
    pnpm run build

# Stage 4: Runner -> Runtime environment
FROM base AS runner
WORKDIR /app

# For performance, security and dependency management
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Create a new user-group 'nodejs' and new user 'nextjs' with minimal permissions for safety
RUN addgroup -S --gid 1001 nodejs && \
    adduser -S --uid 1001 nextjs -G nodejs -s /sbin/nologin

# Set the correct permission for prerender cache
RUN mkdir .next && chown nextjs:nodejs .next

# public remains root-owned. Security best practice -> prevents app from writing to public folder.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000


CMD ["tini", "--", "node", "server.js"]
