#!/usr/bin/env bash
#
# SCRIPTS · test the scripts themselves: every shell script parses, every runnable one is executable
# in git, shellcheck finds nothing in them and actionlint nothing in the workflows.
#
#   ./scripts/gate/selfcheck.sh
#   ./scripts/gate/selfcheck.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

for arg in "$@"; do
  case "$arg" in
    --help|-h)  usage ;;
    *)          refuse "Unknown option: ${arg}. Try --help." ;;
  esac
done

FAILURES=0
note_fail() { fail "$*"; FAILURES=$(( FAILURES + 1 )); }

# Asked of the tree rather than written down, so a script landing anywhere is checked. `--others`, so
# a script is covered the moment it exists; `.claude/` aside, whose hooks are its own to check.
SHELL_FILES=()
while IFS= read -r f; do
  # git lists what the index holds, which a deleted-but-unstaged path outlives.
  [[ -f "$f" && "$f" != .claude/* ]] || continue
  case "${f##*/}" in
    *.sh) ;;
    # A hook carries no suffix, so an extensionless file is asked what runs it.
    *.*)  continue ;;
    *)    IFS= read -r shebang < "$f" || true
          [[ "$shebang" =~ ^#!.*(/|[[:space:]])(ba)?sh([[:space:]]|$) ]] || continue ;;
  esac
  SHELL_FILES+=("$f")
done < <(git ls-files --cached --others --exclude-standard)
if (( ${#SHELL_FILES[@]} == 0 )); then
  refuse "git named no shell script in this repository, so there was nothing to check"
fi

step "1. Syntax"
for f in "${SHELL_FILES[@]}"; do
  bash -n "$f" 2>/dev/null || note_fail "${f} does not parse"
done

step "2. Executable bit is set in git"
# The mode git records, not the filesystem's: on Windows `core.fileMode` is false, so `chmod +x` is
# cosmetic and the script reaches the Linux server non-executable. `scripts/lib/` is sourced, never run.
while IFS=$'\t' read -r meta path; do
  if [[ "$path" == scripts/* && "$path" != scripts/lib/* && "${meta%% *}" != 100755 ]]; then
    note_fail "${path} is mode ${meta%% *} in git, not 100755. Fix:  git update-index --chmod=+x ${path}"
  fi
done < <(git ls-files -s -- "${SHELL_FILES[@]}")

# Pinned so new checks arrive by a named bump, never as drift; a bump replaces the digest too. A
# binary on PATH runs only at the pinned version, and otherwise the image runs through Docker.
SHELLCHECK_VERSION="0.11.0"
SHELLCHECK_IMAGE_DIGEST="sha256:61862eba1fcf09a484ebcc6feea46f1782532571a34ed51fedf90dd25f925a8d"

# Git Bash mounts %TEMP% at /tmp, so a checkout there makes `/$REPO_ROOT` bind an unrelated directory.
mount_source() { cygpath -w "$REPO_ROOT" 2>/dev/null || printf '/%s' "$REPO_ROOT"; }

step "3. shellcheck"
# SC1091 throughout: shellcheck cannot follow the sourced `scripts/lib/_lib.sh`.
sc_rc=0
if [[ "$(shellcheck --version 2>/dev/null | awk '$1 == "version:" { print $2 }')" == "$SHELLCHECK_VERSION" ]]; then
  shellcheck -e SC1091 "${SHELL_FILES[@]}" || sc_rc=$?
elif docker version >/dev/null 2>&1; then
  # MSYS_NO_PATHCONV stops Git Bash rewriting the container path into a Windows one.
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(mount_source):/mnt" -w /mnt \
    "koalaman/shellcheck:v${SHELLCHECK_VERSION}@${SHELLCHECK_IMAGE_DIGEST}" -e SC1091 "${SHELL_FILES[@]}" || sc_rc=$?
else
  note_fail "neither shellcheck ${SHELLCHECK_VERSION} on PATH nor Docker, so no script was linted"
fi
if (( sc_rc )); then note_fail "shellcheck reported the findings above (exit ${sc_rc})"; fi

step "4. actionlint on the workflows"
# 1.7.8 is the floor: earlier versions reject `using: node24`. Its digest moves with its tag.
al_rc=0
if command -v actionlint >/dev/null 2>&1; then
  actionlint || al_rc=$?
elif docker version >/dev/null 2>&1; then
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(mount_source):/repo" -w /repo \
    rhysd/actionlint:1.7.12@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 || al_rc=$?
else
  note_fail "neither actionlint on PATH nor Docker, so no workflow was linted"
fi
if (( al_rc )); then note_fail "actionlint reported the findings above (exit ${al_rc})"; fi

printf '\n'
if (( FAILURES == 0 )); then
  ok "All script self-checks passed."
else
  die --summary "${FAILURES} script self-check(s) failed."
fi
