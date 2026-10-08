# BACKEND · the API image

# A named stage rather than a bare `COPY --from=<image>`: Dependabot's docker ecosystem scans FROM
# lines alone, so this puts the installer's tag and digest (`docs/ops/spec.md` §1.1) under the same
# review as every other base image here.
FROM ghcr.io/astral-sh/uv:0.12.22@sha256:f513a91fc62fe7c17567eee97230dd198e43edb8a9fbecca843714a4358fe1bc AS uv

# The OS layer the build and the runtime share, so anything added here ships in the image.
FROM python:3.14.8-slim@sha256:89fb7d3da20043c370643435258bdd7ab755d326d359001d02988ed15ae5219e AS base

# tini for PID 1 signal routing -> the container shuts down gracefully.
RUN apt-get update && \
    apt-get upgrade -y && \
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

# `--locked`, as uv's Docker guide gives it and CI syncs: a lockfile stale against pyproject.toml
# fails the build, where `--frozen` would ship whatever the stale file names.
RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-install-project --no-dev

COPY . .

RUN --mount=type=cache,target=/root/.cache/uv uv sync --locked --no-dev

FROM base AS runner

# Pinned rather than allocated: the host's secret files are owned by this uid and gid, Compose
# giving a file secret no owner of its own (`docs/ops/spec.md` §1.2).
RUN groupadd --system --gid 1002 fl_api && \
    useradd --system --uid 1002 --gid fl_api --create-home --home-dir /usr/fl_backend --shell /usr/sbin/nologin fl_api_user

ENV PATH="/app/.venv/bin:$PATH"

COPY --from=builder --chown=fl_api_user:fl_api /app/.venv ./.venv

# This copies the whole build context, and fl_backend/.dockerignore is what narrows it.
COPY --chown=fl_api_user:fl_api . .

USER fl_api_user
EXPOSE 8000

# app/asgi.py, not app/main.py: main.py exports the `create_app` factory and builds nothing on
# import, so importing it needs no environment. asgi.py is the one module that constructs the real
# application from the real environment and secret files.

# uvicorn directly, not `fastapi run`: the CLI imports the application before uvicorn configures
# logging, so uvicorn's default handlers install after the app's and print plain text into the JSON
# stream.

# --no-access-log because TraceContextMiddleware writes the per-request line, carrying the trace
# and span ids uvicorn's could not; --log-config routes what uvicorn still logs through the app's
# own handler (docs/logging/spec.md).

# --timeout-graceful-shutdown at a request's whole bound, the deadline and its aborts' grace, so a
# stop cancels no request still inside it; unset, uvicorn waits without limit
# (`docs/ops/spec.md :: I540`).
CMD ["tini", "--", "uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-config", "app/core/uvicorn_logging.json", "--timeout-graceful-shutdown", "11"]
