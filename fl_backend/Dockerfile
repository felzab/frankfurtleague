# Stage 1: Builder
# --------------------------------------------------------------------------------
FROM python:3.14-alpine AS builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Prevent Python from writing .pyc files to disk
ENV UV_COMPILE_BYTECODE=1
# Force uv to copy files instead of hardlinking. Required when moving .venv across Docker stages.
ENV UV_LINK_MODE=copy
# Prevent Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1

WORKDIR /usr/build

# Install build dependencies for C-extensions if needed
RUN apk add --no-cache gcc musl-dev libffi-dev

COPY pyproject.toml uv.lock ./

RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-install-project --no-dev

# Copy application source code
COPY . .

# Run sync again to install the project itself into the .venv. Uses cache.
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Stage 2: Runner
# --------------------------------------------------------------------------------
FROM python:3.14-alpine AS runner

# Prevent Python from writing .pyc files to disk
ENV PYTHONDONTWRITEBYTECODE=1
# Prevent Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1

ENV PATH="/usr/build/.venv/bin:$PATH"

WORKDIR /usr/fl_backend


# Create a new user-group 'fl_api' and new user 'fl_api_user' with minimal permissions for safety
RUN addgroup -S fl_api && \
    adduser -S fl_api_user -G fl_api -h /usr/fl_backend -s /sbin/nologin

# Copy the isolated .venv folder from builder instead of the global /install prefix. Maintain user permissions.
COPY --from=builder --chown=fl_api_user:fl_api /usr/build/.venv /usr/build/.venv

# Set the correct permission for application code
COPY --chown=fl_api_user:fl_api . .

USER fl_api_user

EXPOSE 8000

CMD ["fastapi", "run", "app/main.py", "--host", "0.0.0.0", "--port", "8000"]
