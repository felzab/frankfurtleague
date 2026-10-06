# FRONTEND · the site image

# The OS layer the build and the runtime share, so anything added here ships in the image. Debian
# rather than Alpine: Node's glibc builds are its Tier 1 platform, its musl builds experimental.

# The tag names the Node `package.json :: devEngines` pins (`docs/ops/spec.md :: I511`), and
# Dependabot moves it together with the digest (`docs/ops/spec.md` §1.1).
FROM node:26.10.0-trixie-slim@sha256:ec7758ee051e457b468b32bde57b0879010b325bb9862718e9615225ce4aaae1 AS base

# tini as PID 1, as Node's Docker guidance asks: node there ignores every signal it registered no
# handler for and reaps no orphaned child
# (https://github.com/nodejs/docker-node/blob/33161d6f1329b30670bd3259c8db7bbe7da072c8/docs/BestPractices.md#handling-kernel-signals).
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    rm -rf /var/lib/apt/lists/*

ENV NEXT_TELEMETRY_DISABLED=1

# This stage sits between base and the build stages so the runner inherits none of it: pnpm is
# 57 MB of installer no CMD invokes, and CI/PNPM_HOME are build-time answers that have no business
# in a production process environment.
FROM base AS toolchain
# `package.json :: packageManager` names the same pnpm (`docs/ops/spec.md :: I512`).
ARG PNPM_VERSION=11.28.3

# npm's cache is a mount, so none of it is written into the layer.
RUN --mount=type=cache,id=npm,target=/root/.npm npm install -g pnpm@${PNPM_VERSION}

ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
# pnpm prompts interactively without it, and nothing here can answer.
ENV CI=true

FROM toolchain AS deps
WORKDIR /app

# Only what `pnpm fetch` reads (pnpm.io/cli/fetch): with package.json in this layer's key, renaming
# a script re-downloads every package.
COPY pnpm-lock.yaml pnpm-workspace.yaml* ./

# A patched dependency is one of the things `pnpm fetch` reads, so this joins the lockfile's layer
# rather than package.json's: without it the fetch dies on ERR_PNPM_PATCH_NOT_FOUND.
COPY patches ./patches
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY package.json ./

# `--no-runtime`: the image's own node is the runtime, so the Node `devEngines` pins for a checkout
# is not linked ahead of it. `pnpm fetch` above still downloads that Node into the store cache, and
# ignores the flag.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline --no-runtime

# FROM deps, never `COPY --from=deps` of node_modules: a second transfer on a cold build, and a
# second copy in what `mode=max` exports.
FROM deps AS builder

# This stage has no .env, so the startup gate would reject every variable and the build would die on
# the first module that reads config. The schema is still enforced by local.sh and on every deploy.
ENV SKIP_ENV_VALIDATION=true

# Everything but what `deps` installed from: pnpm's dependency check fails a patch written after the
# install it validated, and a `deps` layer restored from the cache ran its install before this
# context was checked out.
COPY --exclude=patches --exclude=package.json --exclude=pnpm-lock.yaml --exclude=pnpm-workspace.yaml* . .

# Emitted rather than kept by hand: a tracked copy of the schema's names would be a second artefact
# to keep current, and this one cannot disagree with the schema the same image was built from.
RUN pnpm run environment-names environment-names.json

RUN --mount=type=cache,id=next-cache,target=/app/.next/cache \
    pnpm run build

FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
# Next's standalone server binds localhost otherwise, which no other container can reach.
ENV HOSTNAME="0.0.0.0"

# Pinned rather than allocated: the host's secret files are owned by this uid and gid, Compose
# giving a file secret no owner of its own (`docs/ops/spec.md` §1.2).
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --no-log-init --uid 1001 --gid nodejs --no-create-home --shell /usr/sbin/nologin nextjs

# The prerender cache is written at run time, so .next must belong to the runtime user.
RUN mkdir .next && chown nextjs:nodejs .next

# public stays root-owned, so the running app cannot write to it.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Root-owned, as public/ is: only the deploy's preflight reads these
# (`scripts/ops/deploy.sh :: check_frontend_env_names`), and the running app has no business rewriting them.

# The mode is spelled rather than left to the builder's umask: the reader runs as the host's user, not
# root, so a 0600 pair would answer the advisory on every deploy, never the refusal.
COPY --from=builder --chmod=644 /app/environment-names.json /app/scripts/check-environment-names.mjs ./

USER nextjs
EXPOSE 3000

CMD ["tini", "--", "node", "server.js"]
