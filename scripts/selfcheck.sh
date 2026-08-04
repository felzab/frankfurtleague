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
#   3. the executable bit is set in git — Windows silently drops it
#   4. every helper a script calls is actually defined in _lib.sh   <-- the one that was missed
#   5. --help works from an unrelated working directory
#   6. an unknown option is rejected, without needing Docker
#   7. machine-specific scripts declare which platform they target
#   8. a script's --help matches the flags it actually accepts
#   9. shellcheck — a local binary if present, otherwise the official Docker image
#  10. actionlint on the workflow files, which are pipeline code and rot the same way
#  11. the comment-only classifier answers both directions — the one gate decision whose wrong
#      answer is silent
#
# USAGE:
#   ./scripts/selfcheck.sh

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

RUNNABLE=(local.sh verify.sh publish.sh deploy.sh ci_scopes.sh)
FAILURES=0
note_fail() { warn "$*"; FAILURES=$(( FAILURES + 1 )); }

step "1. Syntax"
for f in scripts/*.sh; do
  if bash -n "$f" 2>/dev/null; then info "$(basename "$f")"; else note_fail "$(basename "$f") does not parse"; fi
done

step "2. Line endings are LF"
# A shell script with CRLF fails outright on Linux:
#   bash: ./deploy.sh: /usr/bin/env bash^M: bad interpreter: No such file or directory
# deploy.sh RUNS on the Linux server, so this is not cosmetic.
# .gitattributes (`* text=auto eol=lf`) means git stores LF and a fresh Linux checkout is safe, but a
# file copied directly, or an editor writing CRLF, bypasses that. Windows tolerates CRLF, so this is
# precisely the class of defect that is invisible on the machine that introduces it.
# `tr` is byte-oriented and interprets the escape itself, so no carriage return appears in this
# file. Two rejected alternatives, both verified against a known-CRLF fixture:
#   - awk /\r/  : MSYS awk STRIPS CR on input, so it never matches on Windows — the one
#                  platform where CRLF is actually introduced. Silently useless.
#   - grep for a literal CR: same problem, and it puts the character being detected into the
#                  detector — which then matches itself and flags every script.
for f in scripts/*.sh; do
  if [[ -n "$(tr -dc '\r' < "$f")" ]]; then
    note_fail "$(basename "$f") has CRLF endings. Fix:  tr -d '\r' < $f > t && mv t $f && chmod +x $f"
  else
    info "$(basename "$f")"
  fi
done

step "3. Executable bit is set in git"
# Checks the mode GIT records, not the filesystem. On Windows core.fileMode is false, so `chmod +x`
# in Git Bash is cosmetic and git keeps storing 100644 -- the script then arrives on the Linux server
# non-executable and `./scripts/deploy.sh` fails with "Permission denied". Invisible on Windows,
# because bash can still run a non-executable file when you name the interpreter.
# Fix:  git update-index --chmod=+x scripts/<name>.sh
# _lib.sh is deliberately excluded: it is sourced, never executed.
for f in "${RUNNABLE[@]}"; do
  [[ -f "scripts/$f" ]] || continue
  mode="$(git ls-files -s "scripts/$f" 2>/dev/null | awk '{print $1}')"
  if [[ "$mode" == "100755" ]]; then
    info "$f"
  elif [[ -z "$mode" ]]; then
    info "$f (not tracked by git yet)"
  else
    note_fail "$f is mode ${mode} in git, not 100755 — it will not be executable on the server. Fix:  git update-index --chmod=+x scripts/$f"
  fi
done

step "4. Every helper called is defined  (the check that was missing)"
# Names defined in _lib.sh, including the shell builtins/aliases the scripts rely on.
DEFINED="$(grep -oE '^[a-z_]+\(\)' scripts/_lib.sh | tr -d '()' | sort -u)"
for f in "${RUNNABLE[@]}"; do
  [[ -f "scripts/$f" ]] || continue
  # Anything that looks like one of our helpers: our naming is consistent enough to enumerate.
  called="$(grep -oE '\b(require_[a-z_]+|wait_healthy|image_[a-z_]+|git_[a-z_]+|step|ok|info|skip|warn|die|detail|quietly|fmt_duration|usage|on_error)\b' "scripts/$f" | sort -u || true)"
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

step "5. --help works from an unrelated directory"
for f in "${RUNNABLE[@]}"; do
  if ( cd / && bash "${REPO_ROOT}/scripts/$f" --help >/dev/null 2>&1 ); then
    info "$f --help"
  else
    note_fail "$f --help failed (a relative path that stops resolving after the cd?)"
  fi
done

step "6. Unknown options are rejected, without requiring Docker"
# The output is captured into a variable FIRST, deliberately.
#
# `script | grep -q ...` looks natural and is wrong here: `set -o pipefail` (from _lib.sh) makes a
# pipeline fail if ANY stage failed, and the script under test is SUPPOSED to exit non-zero. So the
# pipeline reported failure on every script that behaved correctly. Capturing first separates
# "did it exit non-zero" (expected) from "did it say the right thing" (what we are checking).
for f in "${RUNNABLE[@]}"; do
  out="$(bash "scripts/$f" --definitely-not-an-option 2>&1 || true)"
  if [[ "$out" == *"Unknown option"* ]]; then
    info "$f"
  else
    note_fail "$f did not reject an unknown option (is the arg loop after an environmental check?)"
  fi
done

step "7. Machine-specific scripts declare a target platform"
# Only the scripts that MUST run on one machine. verify.sh and selfcheck.sh only read and build, so
# pinning them to one OS would be an artificial restriction that also blocks CI.
for f in local.sh publish.sh deploy.sh; do
  if grep -q "require_platform" "scripts/$f"; then info "$f"; else note_fail "$f has no require_platform guard"; fi
done

step "8. Documented flags match accepted flags"
# Catches drift between a script's --help header and its case statement. Compared by READING both,
# never by running the script: invoking each flag for real means `local.sh --fresh` tears down the
# local stack as a side effect of a documentation test.
for f in "${RUNNABLE[@]}"; do
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

step "9. shellcheck"
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
  *) note_fail "shellcheck reported findings:"; printf '%s\n' "$sc_out" | head -40 | detail ;;
esac

step "10. actionlint on the workflows"
# The workflow files are pipeline code: actionlint validates their expressions, job graphs, action
# inputs and embedded shell — the class of bug that otherwise surfaces only on the first live run.
# Same availability ladder as shellcheck: local binary, else the pinned Docker image, else skip.
# With no arguments actionlint finds .github/workflows itself, from the working directory.
run_actionlint() {
  if command -v actionlint >/dev/null 2>&1; then
    actionlint
    return
  fi
  if docker version >/dev/null 2>&1; then
    MSYS_NO_PATHCONV=1 docker run --rm -v "/${REPO_ROOT}:/repo" -w /repo rhysd/actionlint:1.7.7
    return
  fi
  return 2
}

al_out=""; al_rc=0
al_out="$(run_actionlint 2>&1)" || al_rc=$?
case "$al_rc" in
  0) info "no findings in any workflow" ;;
  2) info "unavailable (no local binary and no Docker) — skipped" ;;
  *) note_fail "actionlint reported findings:"; printf '%s\n' "$al_out" | head -40 | detail ;;
esac

step "11. The gate's comment-only classifier"
# check_scope.py decides whether a change to a packaging path is a documentation change, and a WRONG
# ANSWER IS SILENT: classify a real code change as comments and the image build never runs before the
# push. These fixtures pin both directions, including the two cases a line-level rule gets wrong — a
# `//` inside a string literal, and a Dockerfile, which is deliberately never classified at all
# (ADR-0037).
#
# The fixtures sit under the repo root and are passed as RELATIVE paths: MSYS rewrites an absolute
# POSIX path such as mktemp's /tmp/... into a Windows one that the interpreter cannot open, which is
# the same conversion scripts/README.md warns about for bind mounts.
classifier="$(any_python || true)"
if [[ -z "$classifier" ]]; then
  info "no python found — skipped"
else
  fixtures=".tmp-scope-fixtures"
  rm -rf "$fixtures"; mkdir -p "$fixtures"
  trap 'rm -rf "${REPO_ROOT}/.tmp-scope-fixtures"' EXIT

  # Every fixture pair is <name>.old.<ext> and <name>.new.<ext>, with the expected verdict below.
  printf 'const marker = "a//b";\n// first\n'          > "$fixtures/comment.old.ts"
  printf 'const marker = "a//b";\n// second\n'         > "$fixtures/comment.new.ts"
  printf 'const marker = "a//b";\n'                    > "$fixtures/code.old.ts"
  printf 'const marker = "a//c";\n'                    > "$fixtures/code.new.ts"
  printf 'x = 1  # one\ndef f():\n    "doc"\n    return x\n'   > "$fixtures/comment.old.py"
  printf 'x = 1  # two\ndef f():\n    "other doc"\n    return x\n' > "$fixtures/comment.new.py"
  printf 'x = 1\n'                                     > "$fixtures/code.old.py"
  printf 'x = 2\n'                                     > "$fixtures/code.new.py"
  printf 'FROM node:26\n# first\n'                     > "$fixtures/dockerfile.old.Dockerfile"
  printf 'FROM node:26\n# second\n'                    > "$fixtures/dockerfile.new.Dockerfile"

  expect_verdict() {
    local name="$1" ext="$2" want="$3" got
    got="$("$classifier" scripts/check_scope.py --compare "${fixtures}/${name}.old.${ext}" "${fixtures}/${name}.new.${ext}" 2>&1 || true)"
    if [[ "$got" == "$want" ]]; then
      info "${name}.${ext} — ${want}"
    else
      note_fail "${name}.${ext}: the classifier said '${got}', expected '${want}'"
    fi
  }
  expect_verdict comment    ts         comment-only
  expect_verdict code       ts         code
  expect_verdict comment    py         comment-only
  expect_verdict code       py         code
  # Not a gap: a `#` in a Dockerfile heredoc is not a comment, so it is never classified at all.
  expect_verdict dockerfile Dockerfile code

  rm -rf "$fixtures"
  trap - EXIT
fi

printf '\n'
if (( FAILURES == 0 )); then
  ok "All script self-checks passed."
else
  die "${FAILURES} script self-check(s) failed."
fi
