#!/usr/bin/env bash
#
# Stop hook — reports anything still listening on port 3000 when the turn ends.
#
# WHY THIS IS A HOOK:
#   nginx binds 0.0.0.0:3000 for the local stack, so a `next dev` left running makes
#   `./scripts/local.sh` start its containers, report them healthy, and serve nothing — "this site
#   can't be reached" under a success message, which is a genuinely confusing pair to debug. The
#   moment to catch it is the moment the turn ends, which is exactly when it is easy to forget.
#
# DELIBERATELY ADVISORY, NOT BLOCKING: the owner runs the stack themselves, so a listener on 3000 is
# often correct. This reports what holds the port and leaves the judgement to the reader.
#
# It does NOT test for `node.exe` — Claude Code is itself node, so that check can never be quiet.
#
# TARGET PLATFORM: Windows (netstat/tasklist). Exits silently anywhere else.
#
# **Never test the state column against "LISTENING".** netstat localises it — this machine is German
# and prints ABHÖREN — so a state match makes this hook silently dead, which is worse than absent. A
# listening socket is identified instead by its wildcard foreign address, which is locale-independent.

command -v netstat >/dev/null 2>&1 || exit 0

pid="$(netstat -ano 2>/dev/null | tr -d '\r' |
  awk '$1 == "TCP" && $2 ~ /:3000$/ && ($3 == "0.0.0.0:0" || $3 == "[::]:0") { print $5; exit }')"

[ -n "$pid" ] || exit 0

name="$(tasklist //FI "PID eq $pid" //FO CSV //NH 2>/dev/null | tr -d '\r' | head -1 | cut -d, -f1 | tr -d '"')"
[ -n "$name" ] || name="pid $pid"

printf '{"systemMessage":"Port 3000 is still held by %s (pid %s). If that is a dev server rather than your own stack, it will make ./scripts/local.sh come up unreachable — stop it, or run ./scripts/local.sh --down."}' "$name" "$pid"

exit 0
