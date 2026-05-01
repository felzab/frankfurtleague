#!/bin/bash

docker pull felzab/digi:frontend && docker pull felzab/digi:backend

docker compose down

docker compose up -d --force-recreate