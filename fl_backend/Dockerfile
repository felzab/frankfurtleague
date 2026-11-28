# A named stage rather than a bare `COPY --from=<image>`: Dependabot's docker ecosystem scans FROM
# lines alone, so this puts the installer's tag and digest under the same
# review as every other base image here.
FROM ghcr.io/astral-sh/uv:0.13.9@sha256:d3b601f0c7b118bc1753febf7c41cc80981df678445e0254284eecf84db79a7d AS uv

# The OS layer the build and the runtime share, so anything added here ships in the image.
FROM python:3.15.2-slim@sha256:65a65fc7b30b06cb6df4930fd4650697cb23f4c2698ab81fc87e4b031bc36928 AS base

# tini for PID 1 signal routing -> the container shuts down gracefully.
RUN apt-get update && \
    apt-get install -y --no-install-recommends tini && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1

WORKDIR /app

FROM base AS builder

# uv is copied here rather than into `base`, so the runner does not inherit 54 MB of an installer
# nothing at run time invokes: the CMD below runs uvicorn out of the copied virtualenv.
COPY --from=uv /uv /uvx /bin/

# These settings steer `uv sync` alone, so they belong to the stage that runs it.
ENV UV_COMPILE_BYTECODE=1
# Copy mode, not symlinks: the .venv moves across stages and a symlink would not survive it.
ENV UV_LINK_MODE=copy

# Manifests before the source, so a source-only change does not invalidate the dependency layer.
COPY pyproject.toml uv.lock ./

# `--locked` at both syncs, as CI syncs: a lockfile stale against pyproject.toml fails the build,
# where `--frozen` would ship its stale pins. uv's Docker guide's first `--frozen` sync mounts uv.lock
# alone; this one has the manifest to check against.
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-install-project --no-dev

COPY . .

RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev

FROM base AS runner

# Pinned rather than allocated: the host's secret files are owned by this uid and gid, Compose
# giving a file secret no owner of its own.
RUN groupadd --system --gid 1002 fl_api && \
    useradd --system --uid 1002 --gid fl_api --create-home --home-dir /usr/fl_backend --shell /usr/sbin/nologin fl_api_user

ENV PATH="/app/.venv/bin:$PATH"

COPY --from=builder --chown=fl_api_user:fl_api /app/.venv ./.venv

# This copies the whole build context, and fl_backend/.dockerignore is what narrows it.
COPY --chown=fl_api_user:fl_api . .

USER fl_api_user
EXPOSE 8000

# The version CI builds the image with, as a build argument, its `sha-<commit>` tag and the value its
# `org.opencontainers.image.version` label carries, which the start-up line logs. Last, so a new value per commit
# rebuilds no layer above it. A build handed none sets the variable to the empty string, since an `ENV` cannot
# leave it unset, and the settings read an empty variable as unset, so that build logs it as null.
ARG APP_VERSION
ENV APP_VERSION=$APP_VERSION

# app/asgi.py, not app/main.py: main.py exports the `create_app` factory and builds nothing on
# import, so importing it needs no environment. asgi.py is the one module that constructs the real
# application from the real environment and secret files.

# uvicorn directly, not `fastapi run`: the CLI imports the application before uvicorn configures
# logging, so uvicorn's default handlers install after the app's and print plain text into the JSON
# stream.

# --no-access-log because TraceContextMiddleware writes the request's one line, carrying the trace id
# and a refusal's code uvicorn's could not. Importing the app takes uvicorn's own handlers off, so
# what uvicorn still logs reaches the app's.

# --loop asyncio --http h11, the pure-Python pair bare uvicorn ships with, named so that no import
# decides what the server runs on.

# --timeout-graceful-shutdown at the longest request's whole bound, an hourly pass's deadline and its
# aborts' grace, so a stop cancels no request still inside it; unset, uvicorn waits without limit.
CMD ["tini", "--", "uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--loop", "asyncio", "--http", "h11", "--timeout-graceful-shutdown", "61"]
