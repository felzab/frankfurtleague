#!/bin/bash

docker login -u felzab

docker pull felzab/frankfurtleague:frontend && docker pull felzab/frankfurtleague:backend

docker compose down

docker compose -f "docker-compose.yml" up -d --force-recreate
