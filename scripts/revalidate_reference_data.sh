#!/usr/bin/env bash
#
# scripts/revalidate_reference_data.sh — drop the frontend cache for one reference resource.
# TARGET PLATFORM: Linux (the production server).
#
# WHEN TO RUN IT:
#   After editing `saisons`, `spieler` or `spieltage` directly in MongoDB. Those three are cached with
#   cacheLife("days") and have no admin write surface, so nothing invalidates them automatically and
#   the site keeps serving the old values for up to 24 hours. Everything else — matches, venues,
#   referees — the admin UI already invalidates when you save.
#
# HOW IT WORKS:
#   The request runs INSIDE the frontend container. /api/revalidate is not exposed through nginx —
#   nginx routes /api to the backend — so the route is reachable only on the container network, and
#   INTERNAL_API_KEY_SYSTEM is read from the container's own environment. The key therefore never
#   reaches this script, your shell history or a log line.
#
#   node, not wget: the image is node:alpine, whose busybox wget cannot set a request method or a JSON
#   body, and there is no curl. node is guaranteed present.
#
# USAGE:
#   ./scripts/revalidate_reference_data.sh saisons
#   ./scripts/revalidate_reference_data.sh spieler
#   ./scripts/revalidate_reference_data.sh spieltage
#   ./scripts/revalidate_reference_data.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

RESOURCE=""
for arg in "$@"; do
  case "$arg" in
    saisons|spieler|spieltage) RESOURCE="$arg" ;;
    --help|-h) usage ;;
    *) die "Unknown resource: '${arg}'.
       Only saisons, spieler and spieltage need this — they are the three with no write surface.
       Everything else the admin UI already invalidates when you save." ;;
  esac
done

[[ -n "$RESOURCE" ]] || die "Name a resource: saisons, spieler or spieltage. See --help."

require_platform linux
require_docker
require_file "docker-compose.yml"

step "Revalidating ${RESOURCE}"

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
' "$RESOURCE" || die "Revalidation failed for ${RESOURCE}.
       Is the frontend container running?  docker compose ps frontend"

ok "${RESOURCE} revalidated — the next request rebuilds it from the backend"
