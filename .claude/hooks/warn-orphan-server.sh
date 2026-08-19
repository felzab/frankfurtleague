#!/usr/bin/env bash
# Stop hook — names what still holds port 3000 when the turn ends. Advisory, never blocking.
# A listener is found by its wildcard foreign address: netstat localises the state column, and this
# machine prints ABHÖREN, so matching "LISTENING" would make the hook silently dead.

command -v netstat >/dev/null 2>&1 || exit 0

pid="$(netstat -ano 2>/dev/null | tr -d '\r' |
  awk '$1 == "TCP" && $2 ~ /:3000$/ && ($3 == "0.0.0.0:0" || $3 == "[::]:0") { print $5; exit }')"

[ -n "$pid" ] || exit 0

name="$(tasklist //FI "PID eq $pid" //FO CSV //NH 2>/dev/null | tr -d '\r' | head -1 | cut -d, -f1 | tr -d '"')"
[ -n "$name" ] || name="pid $pid"

printf '{"systemMessage":"Port 3000 is still held by %s (pid %s). If that is a dev server rather than your own stack, it will make ./scripts/local.sh come up unreachable — stop it, or run ./scripts/local.sh --down."}' "$name" "$pid"

exit 0
