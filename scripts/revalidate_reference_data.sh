#!/bin/bash
# Target platform: Linux (production host) / any shell with docker compose.
#
# Drops the frontend's cache for one reference resource. Run this after editing `saisons`,
# `spieler` or `spieltage` directly in MongoDB -- those three have no frontend write surface and no
# backend write endpoint, so nothing invalidates them automatically and the site serves the old data
# for up to 24 hours (they are cached with cacheLife("days")).
#
# This is the BE-3 runbook step. It stayed a runbook step rather than backend code because
# fl_backend has no write path for these three collections -- every write endpoint under
# app/api/admin/ touches spiele, spielorte or schiedsrichter, which the admin UI already invalidates.
#
# The request runs *inside* the frontend container: /api/revalidate is not exposed through nginx
# (nginx routes /api to FastAPI), and INTERNAL_API_KEY_SYSTEM is read from the container's own
# environment, so the key never reaches this script, the shell history, or a log line.
#
# Usage: ./scripts/revalidate_reference_data.sh saisons|spieler|spieltage

set -euo pipefail

RESOURCE="${1:-}"

case "$RESOURCE" in
  saisons | spieler | spieltage) ;;
  *)
    echo "Usage: $0 saisons|spieler|spieltage" >&2
    exit 2
    ;;
esac

# node, not wget: the image is node:alpine, whose busybox wget has no --method and no way to set a
# request body on anything but --post-data. There is no curl either. node is guaranteed present.
docker compose exec -T frontend node -e '
  const [resource] = process.argv.slice(1);
  const res = await fetch("http://127.0.0.1:3000/api/revalidate", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.INTERNAL_API_KEY_SYSTEM}` },
    body: JSON.stringify({ resource }),
  });
  if (res.status !== 204) {
    console.error(`Revalidation failed for ${resource}: HTTP ${res.status}`);
    process.exit(1);
  }
  console.log(`Revalidated: ${resource}`);
' "$RESOURCE"
