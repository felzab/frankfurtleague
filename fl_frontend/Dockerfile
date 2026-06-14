# Stage 1: Dependencies
# --------------------------------------------------------------------------------
FROM node:26-alpine3.24 AS deps

# Compiled binaries in c won't run without this
RUN apk add --no-cache libc6-compat

WORKDIR /usr/deps

COPY package.json package-lock.json* ./
RUN npm ci

# Stage 2: Builder
# --------------------------------------------------------------------------------
FROM node:26-alpine3.24 AS builder

# For performance, security and dependency management
ENV NODE_ENV=production
# So that the build does not crash (placeholder/dummy)
ENV MONGODB_URI=mongodb://localhost:27017/placeholder
# So that zod does not throw an error
ENV SKIP_ENV_VALIDATION=true

WORKDIR /usr/build

COPY --from=deps /usr/deps/node_modules ./node_modules
COPY . .

# Disable nextjs telemetry
RUN npx next telemetry disable
RUN npm run build

# Stage 3: Runner
# --------------------------------------------------------------------------------
FROM node:26-alpine3.24 AS runner

WORKDIR /usr/fl_frontend

# For performance, security and dependency management
ENV NODE_ENV=production

# Create a new user-group 'nodejs' and new user 'nextjs' with minimal permissions for safety
RUN addgroup -S --gid 1001 nodejs && \
    adduser -S --uid 1001 nextjs -G nodejs -h /usr/fl_frontend -s /sbin/nologin

# Set the correct permission for prerender cache
RUN mkdir .next && chown nextjs:nodejs .next

# Extract only the things you need to run the application
COPY --from=builder --chown=nextjs:nodejs /usr/build/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /usr/build/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /usr/build/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
