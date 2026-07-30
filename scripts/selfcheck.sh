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
#   2. line endings are LF — CRLF makes a script fail outright on the Linux server
#   3. every helper a script calls is actually defined in _lib.sh   <-- the one that was missed
#   4. --help works from an unrelated working directory
#   5. an unknown option is rejected, without needing Docker
#   6. each script declares which platform it targets
#   7. a script's --help matches the flags it actually accepts
#   8. shellcheck — a local binary if present, otherwise the official Docker image
#
# USAGE:
#   ./scripts/selfcheck.sh

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

RUNNABLE=(local.sh verify.sh publish.sh deploy.sh revalidate_reference_data.sh)
FAILURES=0
note_fail() { warn "$*"; FAILURES=$(( FAILURES + 1 )); }

step "1. Syntax"
for f in scripts/*.sh; do
  if bash -n "$f" 2>/dev/null; then info "$(basename "$f")"; else note_fail "$(basename "$f") does not parse"; fi
done

step "2. Line endings are LF"
# A shell script with CRLF fails outright on Linux:
#   bash: ./deploy.sh: /usr/bin/env bash^M: bad interpreter: No such file or directory
# deploy.sh and revalidate_reference_data.sh RUN on the Linux server, so this is not cosmetic.
# .gitattributes (`* text=auto eol=lf`) means git stores LF and a fresh Linux checkout is safe, but a
# file copied directly, or an editor writing CRLF, bypasses that. Windows tolerates CRLF, so this is
# precisely the class of defect that is invisible on the machine that introduces it.
# `tr` is byte-oriented and interprets the escape itself, so no carriage return appears in this
# file. Two rejected alternatives, both verified against a known-CRLF fixture:
#   - awk /\r/  : MSYS awk STRIPS CR on input, so it never matches on Windows — the one
#                  platform where CRLF is actually introduced. Silently useless.
#   - grep for a literal CR: same problem, and it puts the character being detected into the
#                  detector, which is how an earlier version matched itself and flagged everything.
for f in scripts/*.sh; do
  if [[ -n "$(tr -dc '\r' < "$f")" ]]; then
    note_fail "$(basename "$f") has CRLF endings. Fix:  tr -d '\r' < $f > t && mv t $f && chmod +x $f"
  else
    info "$(basename "$f")"
  fi
done

step "3. Every helper called is defined  (the check that was missing)"
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

step "4. --help works from an unrelated directory"
for f in local.sh verify.sh publish.sh deploy.sh; do
  if ( cd / && bash "${REPO_ROOT}/scripts/$f" --help >/dev/null 2>&1 ); then
    info "$f --help"
  else
    note_fail "$f --help failed (a relative path that stops resolving after the cd?)"
  fi
done

step "5. Unknown options are rejected, without requiring Docker"
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

step "6. Machine-specific scripts declare a target platform"
# Only the scripts that MUST run on one machine. verify.sh and selfcheck.sh only read and build, so
# pinning them to one OS would be an artificial restriction that also blocks CI.
for f in local.sh publish.sh deploy.sh revalidate_reference_data.sh; do
  if grep -q "require_platform" "scripts/$f"; then info "$f"; else note_fail "$f has no require_platform guard"; fi
done

step "7. Documented flags match accepted flags"
# Catches drift between a script's --help header and its case statement. Compared by READING both,
# never by running the script: an earlier version of this check invoked each flag for real, which
# meant `local.sh --fresh` tore down the local stack as a side effect of a documentation test.
for f in local.sh verify.sh publish.sh deploy.sh revalidate_reference_data.sh; do
  # Header only: take the contiguous comment block and STOP at the first line of code. Reading a
  # fixed line range instead compared the code against itself, because the case statement fell
  # inside the range -- so the check passed while a genuinely undocumented flag was present.
  doc="$(awk 'NR>1 { if ($0 !~ /^#/) exit; print }' "scripts/$f" | grep -oE -- '--[a-z-]+' | sort -u | tr '\n' ' ')"
  code="$(grep -oE '^[[:space:]]+--[a-z|[:space:]-]+\)' "scripts/$f" | tr -d ' )' | tr '|' '\n' | grep -oE -- '--[a-z-]+' | sort -u | tr '\n' ' ')"
  if [[ "$doc" == "$code" ]]; then
    info "$f"
  else
    note_fail "$f: --help documents [${doc}] but the code accepts [${code}]"
  fi
done

step "8. shellcheck"
# SC1091 is excluded throughout: shellcheck cannot follow the sourced _lib.sh, which is expected and
# not a defect. SC2034 is annotated inline in _lib.sh rather than excluded globally.
run_shellcheck() {
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -e SC1091 "$@"
    return
  fi
  # No local binary: use the official image, which is how shellcheck is actually reachable on a
  # Windows dev machine. MSYS_NO_PATHCONV stops Git Bash rewriting the container path into a Windows
  # one — the same mangling that produced the stray `;C` directories in this repo.
  if docker version >/dev/null 2>&1; then
    MSYS_NO_PATHCONV=1 docker run --rm -v "/${REPO_ROOT}:/mnt" -w /mnt \
      koalaman/shellcheck:stable -e SC1091 "$@"
    return
  fi
  return 2
}

sc_out=""; sc_rc=0
sc_out="$(run_shellcheck scripts/*.sh 2>&1)" || sc_rc=$?
case "$sc_rc" in
  0) info "no findings in any script" ;;
  2) info "unavailable (no local binary and no Docker) — skipped" ;;
  *) note_fail "shellcheck reported findings:"; printf '%s\n' "$sc_out" | head -40 | sed 's/^/       /' ;;
esac

printf '\n'
if (( FAILURES == 0 )); then
  ok "All script self-checks passed."
else
  die "${FAILURES} script self-check(s) failed."
fi
