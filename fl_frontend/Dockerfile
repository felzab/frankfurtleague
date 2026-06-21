ARG PNPM_VERSION=11.8.0


# Stage 1: Deps & Builder
# --------------------------------------------------------------------------------
FROM node:26-alpine3.24 AS builder
ARG PNPM_VERSION

# For performance, security and dependency management
ENV NODE_ENV=production
# So that the build does not crash (placeholder/dummy)
ENV MONGODB_URI=mongodb://localhost:27017/placeholder
# So that zod does not throw an error
ENV SKIP_ENV_VALIDATION=true
# Disables nextjs telemetry
ENV NEXT_TELEMETRY_DISABLED=1
ENV CI=true

# Compiled binaries in c won't run without this
RUN apk add --no-cache libc6-compat
WORKDIR /usr/fl_frontend

# Install PNPM globally
RUN npm install -g pnpm@${PNPM_VERSION}
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"

COPY pnpm-lock.yaml ./
# Fetch dependencies into the BuildKit cache
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch

# Copy package configs and install offline
COPY package.json pnpm-workspace.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

COPY . .

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    --mount=type=cache,id=next-cache,target=/usr/fl_frontend/.next/cache \
    pnpm run build

# Stage 2: Runner
# --------------------------------------------------------------------------------
FROM node:26-alpine3.24 AS runner

WORKDIR /usr/fl_frontend

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create a new user-group 'nodejs' and new user 'nextjs' with minimal permissions for safety
RUN addgroup -S --gid 1001 nodejs && \
    adduser -S --uid 1001 nextjs -G nodejs -h /usr/fl_frontend -s /sbin/nologin

# Set the correct permission for prerender cache
RUN mkdir .next && chown nextjs:nodejs .next

# Extract only the things you need to run the application
COPY --from=builder --chown=nextjs:nodejs /usr/fl_frontend/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /usr/fl_frontend/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /usr/fl_frontend/public ./public

USER nextjs

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
