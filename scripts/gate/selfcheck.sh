#!/usr/bin/env bash
#
# SCRIPTS · test the scripts themselves: every runnable shell script is executable in git, and
# neither shellcheck finds anything in the scripts nor actionlint in the workflows. Both linters run
# in Docker, from the images scripts/gate/tools.Dockerfile pins.
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
# A linter that could not run judged nothing, which the exit contract spells 2 once no finding outranks it.
UNRUN=()

# Asked of the tree rather than written down, so a script landing anywhere is checked. `--others`, so
# a script is covered the moment it exists.
SHELL_FILES=()
while IFS= read -r f; do
  # git lists what the index holds, which a deleted-but-unstaged path outlives.
  [[ -f "$f" ]] || continue
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

step "1. Executable bit is set in git"
# The mode git records, not the filesystem's: on Windows `core.fileMode` is false, so `chmod +x` is
# cosmetic and the script reaches the Linux server non-executable. `scripts/lib/` is sourced, never run.
while IFS=$'\t' read -r meta path; do
  if [[ "$path" == scripts/* && "$path" != scripts/lib/* && "${meta%% *}" != 100755 ]]; then
    note_fail "${path} is mode ${meta%% *} in git, not 100755. Fix:  git update-index --chmod=+x ${path}"
  fi
done < <(git ls-files -s -- "${SHELL_FILES[@]}")

# Each linter is the image its stage names in the tools file, so a release reaches the gate by a
# named bump alone and runs the same on every machine.
TOOLS_FILE="scripts/gate/tools.Dockerfile"
tool_image() { # $1 the stage naming the tool
  local image
  image="$(sed -nE "s/^FROM ([^ ]+) AS ${1}\$/\1/p" "$TOOLS_FILE")"
  if [[ -z "$image" || "$image" == *$'\n'* ]]; then return 1; fi
  printf '%s' "$image"
}

# Git Bash mounts %TEMP% at /tmp, so a checkout there makes `/$REPO_ROOT` bind an unrelated directory.
mount_source() { cygpath -w "$REPO_ROOT" 2>/dev/null || printf '/%s' "$REPO_ROOT"; }

sc_rc=0
al_rc=0
if ! docker version >/dev/null 2>&1; then
  UNRUN+=("Docker is not responding, so no script and no workflow was linted")
elif ! SHELLCHECK_IMAGE="$(tool_image shellcheck)" || ! ACTIONLINT_IMAGE="$(tool_image actionlint)"; then
  note_fail "${TOOLS_FILE} names no single FROM line for shellcheck and actionlint each, so neither ran"
else
  step "2. shellcheck"
  # SC1091 throughout: shellcheck cannot follow the sourced library. A script that does not parse is
  # one of its errors. MSYS_NO_PATHCONV stops Git Bash rewriting the container path into a Windows one.
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(mount_source):/mnt" -w /mnt \
    "$SHELLCHECK_IMAGE" -e SC1091 "${SHELL_FILES[@]}" || sc_rc=$?

  step "3. actionlint on the workflows"
  MSYS_NO_PATHCONV=1 docker run --rm -v "$(mount_source):/repo" -w /repo "$ACTIONLINT_IMAGE" || al_rc=$?
fi
if (( sc_rc )); then note_fail "shellcheck reported the findings above (exit ${sc_rc})"; fi
if (( al_rc )); then note_fail "actionlint reported the findings above (exit ${al_rc})"; fi

printf '\n'
if (( FAILURES > 0 )); then
  die --summary "${FAILURES} script self-check(s) failed."
elif (( ${#UNRUN[@]} > 0 )); then
  refuse "$(printf '%s\n' "${UNRUN[@]}")"
fi
ok "All script self-checks passed."
