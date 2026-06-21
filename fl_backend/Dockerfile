# Stage 1: Base -> Setup OS deps and package manager
FROM python:3.14-alpine AS base

# Install tini for proper PID 1 signal routing -> allows graceful shutdown
RUN apk add --no-cache tini

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

# Install Alpine C-extension build dependencies
RUN apk add --no-cache gcc musl-dev libffi-dev

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
RUN addgroup -S fl_api && adduser -S fl_api_user -G fl_api -h /usr/fl_backend -s /sbin/nologin

# Prepend virtual environment binaries to PATH -> Bypasses needing to activate .venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy compiled .venv from builder. Assign correct ownership.
COPY --from=builder --chown=fl_api_user:fl_api /app/.venv ./.venv

# Copy application code. Exclude local configs via .dockerignore in practice.
COPY --chown=fl_api_user:fl_api . .

USER fl_api_user
EXPOSE 8000

CMD ["tini", "--", "fastapi", "run", "app/main.py", "--host", "0.0.0.0", "--port", "8000"]
