#!/usr/bin/env bash
#
# scripts/selfcheck.sh — test the scripts themselves.
# TARGET PLATFORM: any (Windows or Linux).
#
# WHY THIS EXISTS:
#   `bash -n` checks SYNTAX ONLY. It cannot see that a script calls a function which does not exist,
#   because that is only discoverable at run time. Exactly that shipped: _lib.sh's helper was renamed
#   require_env_file -> require_file, deploy.sh was updated, local.sh was not, and every syntax check
#   passed. The failure surfaced only when a human ran it.
#
#   This script closes that gap. Run it after touching anything in scripts/.
#
# WHAT IT CHECKS:
#   1. every script parses
#   2. every helper a script calls is actually defined in _lib.sh   <-- the one that was missed
#   3. --help works from an unrelated working directory
#   4. an unknown option is rejected, without needing Docker
#   5. each script declares which platform it targets
#   6. shellcheck, if it is installed
#
# USAGE:
#   ./scripts/selfcheck.sh

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

RUNNABLE=(local.sh verify.sh publish.sh deploy.sh revalidate_reference_data.sh)
FAILURES=0
note_fail() { warn "$*"; FAILURES=$(( FAILURES + 1 )); }

step "1. Syntax"
for f in scripts/*.sh; do
  bash -n "$f" 2>/dev/null && info "$(basename "$f")" || note_fail "$(basename "$f") does not parse"
done

step "2. Every helper called is defined  (the check that was missing)"
# Names defined in _lib.sh, including the shell builtins/aliases the scripts rely on.
DEFINED="$(grep -oE '^[a-z_]+\(\)' scripts/_lib.sh | tr -d '()' | sort -u)"
for f in "${RUNNABLE[@]}"; do
  [[ -f "scripts/$f" ]] || continue
  # Anything that looks like one of our helpers: our naming is consistent enough to enumerate.
  called="$(grep -oE '\b(require_[a-z_]+|wait_healthy|image_[a-z_]+|git_[a-z_]+|step|ok|info|warn|die|usage|on_error)\b' "scripts/$f" | sort -u || true)"
  missing=""
  while IFS= read -r fn; do
    [[ -z "$fn" ]] && continue
    grep -qx "$fn" <<< "$DEFINED" || missing+=" $fn"
  done <<< "$called"
  if [[ -n "$missing" ]]; then
    note_fail "$f calls undefined helper(s):$missing"
  else
    info "$f — all helpers resolve"
  fi
done

step "3. --help works from an unrelated directory"
for f in local.sh verify.sh publish.sh deploy.sh; do
  if ( cd / && bash "${REPO_ROOT}/scripts/$f" --help >/dev/null 2>&1 ); then
    info "$f --help"
  else
    note_fail "$f --help failed (a relative path that stops resolving after the cd?)"
  fi
done

step "4. Unknown options are rejected, without requiring Docker"
# The output is captured into a variable FIRST, deliberately.
#
# `script | grep -q ...` looks natural and is wrong here: `set -o pipefail` (from _lib.sh) makes a
# pipeline fail if ANY stage failed, and the script under test is SUPPOSED to exit non-zero. So the
# pipeline reported failure on every script that behaved correctly. Capturing first separates
# "did it exit non-zero" (expected) from "did it say the right thing" (what we are checking).
for f in local.sh verify.sh publish.sh deploy.sh; do
  out="$(bash "scripts/$f" --definitely-not-an-option 2>&1 || true)"
  if [[ "$out" == *"Unknown option"* ]]; then
    info "$f"
  else
    note_fail "$f did not reject an unknown option (is the arg loop after an environmental check?)"
  fi
done

step "5. Each script declares a target platform"
for f in local.sh verify.sh publish.sh deploy.sh; do
  grep -q "require_platform" "scripts/$f" && info "$f" || note_fail "$f has no require_platform guard"
done

step "6. shellcheck (optional)"
if command -v shellcheck >/dev/null 2>&1; then
  # SC1091: shellcheck cannot follow the sourced _lib.sh; that is expected, not a defect.
  for f in scripts/*.sh; do
    shellcheck -e SC1091 "$f" >/dev/null 2>&1 && info "$(basename "$f")" || note_fail "shellcheck findings in $(basename "$f") — run: shellcheck -e SC1091 $f"
  done
else
  info "shellcheck not installed — skipped (optional; it catches quoting bugs this script does not)"
fi

printf '\n'
if (( FAILURES == 0 )); then
  ok "All script self-checks passed."
else
  die "${FAILURES} script self-check(s) failed."
fi
