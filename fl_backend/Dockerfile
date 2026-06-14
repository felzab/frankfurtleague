# Stage 1: Builder
# --------------------------------------------------------------------------------
FROM python:3.14.6-alpine AS builder

# Prevent Python from writing .pyc files to disk
ENV PYTHONDONTWRITEBYTECODE=1
# Prevent Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1

WORKDIR /usr/build

# Install build dependencies for C-extensions if needed
RUN apk add --no-cache gcc musl-dev libffi-dev

COPY requirements.txt .

# Install dependencies into a dedicated folder
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Stage 2: Runner
# --------------------------------------------------------------------------------
FROM python:3.14.6-alpine AS runner

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /usr/fl_backend


# Create a new user-group 'fl_api' and new user 'fl_api_user' with minimal permissions for safety
RUN addgroup -S fl_api && \
    adduser -S fl_api_user -G fl_api -h /usr/fl_backend -s /sbin/nologin

COPY --from=builder /install /usr/local

# Set the correct permission
COPY --chown=fl_api_user:fl_api . .

USER fl_api_user

EXPOSE 8000

CMD ["fastapi", "run", "app/main.py", "--host", "0.0.0.0", "--port", "8000"]
