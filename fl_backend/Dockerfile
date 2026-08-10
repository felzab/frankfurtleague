# Stage 1: Base -> Setup OS deps and package manager
FROM python:3.14-slim AS base

# tini for PID 1 signal routing -> the container shuts down gracefully.
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends tini && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

ENV PYTHONUNBUFFERED=1
ENV UV_COMPILE_BYTECODE=1
# Copy mode, not symlinks: the .venv moves across stages and a symlink would not survive it.
ENV UV_LINK_MODE=copy

WORKDIR /app

# Stage 2: Builder -> Compile app
FROM base AS builder

# Manifests before the source, so a source-only change does not invalidate the dependency layer.
COPY pyproject.toml uv.lock ./

RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project --no-dev

COPY . .

RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

# Stage 3: Runner -> Runtime environment
FROM base AS runner

RUN addgroup --system fl_api && adduser --system --group fl_api_user --home /usr/fl_backend --shell /usr/sbin/nologin

ENV PATH="/app/.venv/bin:$PATH"

COPY --from=builder --chown=fl_api_user:fl_api /app/.venv ./.venv

# fl_backend/.dockerignore keeps .env and the local virtualenv out of the image.
COPY --chown=fl_api_user:fl_api . .

USER fl_api_user
EXPOSE 8000

# app/asgi.py, not app/main.py: main.py exports the `create_app` factory and builds nothing on
# import, so importing it needs no environment. asgi.py is the one module that constructs the real
# application from the real environment.

# uvicorn directly, not `fastapi run`: the CLI imports the application before uvicorn configures
# logging, so uvicorn's default handlers install after the app's and print plain text into the JSON
# stream.

# --no-access-log because CorrelationIdMiddleware writes the per-request line, carrying the
# correlation id uvicorn's could not; --log-config routes what uvicorn still logs through the app's
# own handler (docs/logging/spec.md).
CMD ["tini", "--", "uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-config", "app/core/uvicorn_logging.json"]
