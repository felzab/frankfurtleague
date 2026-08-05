# Stage 1: Base -> Setup OS deps and package manager
FROM python:3.14-slim AS base

# Update indexes, patch OS vulnerabilities, install tini, and clean cache in a single layer
# Install tini for proper PID 1 signal routing -> allows graceful shutdown
RUN apt-get update && \
    apt-get upgrade -y && \
    apt-get install -y --no-install-recommends tini && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Prevent Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1
# Precompile Python bytecode during uv sync -> Faster container startup time
ENV UV_COMPILE_BYTECODE=1
# Force copy mode -> Prevents broken symlinks when moving .venv across stages
ENV UV_LINK_MODE=copy

WORKDIR /app

# Stage 2: Builder -> Compile app
FROM base AS builder

# Copy dependency manifests first -> Maximize Docker layer caching
COPY pyproject.toml uv.lock ./

# Install dependencies into .venv
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project --no-dev

COPY . .

# Install the project itself into the existing .venv
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev

# Stage 3: Runner -> Runtime environment
FROM base AS runner

# Create a new user-group 'fl_api' and new user 'fl_api_user' with minimal permissions for safety
RUN addgroup --system fl_api && adduser --system --group fl_api_user --home /usr/fl_backend --shell /usr/sbin/nologin

# Prepend virtual environment binaries to PATH -> Bypasses needing to activate .venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy compiled .venv from builder. Assign correct ownership.
COPY --from=builder --chown=fl_api_user:fl_api /app/.venv ./.venv

# Copy application code. Exclude local configs via .dockerignore in practice.
COPY --chown=fl_api_user:fl_api . .

USER fl_api_user
EXPOSE 8000

# app/asgi.py, not app/main.py: main.py exports the `create_app` FACTORY and builds nothing on
# import, so importing it needs no environment. asgi.py is the one module that constructs the real
# application from the real environment, and it is the only thing that loads it.
#
# uvicorn directly, not `fastapi run`: the CLI imports the application before uvicorn configures
# logging, so uvicorn's default handlers were installed AFTER the app's and printed plain-text lines
# into the JSON stream. --no-access-log because CorrelationIdMiddleware writes the per-request line
# (with the correlation id uvicorn's line could never carry); --log-config routes what uvicorn still
# logs through the app's own handler (docs/logging.md).
CMD ["tini", "--", "uvicorn", "app.asgi:app", "--host", "0.0.0.0", "--port", "8000", "--no-access-log", "--log-config", "app/core/uvicorn_logging.json"]
