#!/bin/bash

# 1. Stop containers and destroy associated named volumes (-v) to clear stale Next.js assets
docker compose -f ./docker-compose.local.yml down -v

# 2. Force image rebuilding (--build) before starting the containers
docker compose -f ./docker-compose.local.yml up --build
