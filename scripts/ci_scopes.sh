#!/usr/bin/env bash
#
# SCRIPTS · map the changed paths of a branch to verify.sh scopes.
#
# Prints one `name=true|false` line per scope on stdout, the shape `$GITHUB_OUTPUT` accepts, and the
# human-readable summary on stderr, where it cannot leak into the outputs. Both workflows and
# `scripts/check_scope.py` read this one copy, so selfcheck.sh and shellcheck cover the mapping like
# any other script. Arms are matched most-specific-first and a path no arm recognises turns every
# scope on, so a new kind of file can never silently skip validation.
#
#   ./scripts/ci_scopes.sh origin/main   scopes for the diff against the merge base with that ref
#   ./scripts/ci_scopes.sh --all         every scope true — a push to main proves everything
#   ./scripts/ci_scopes.sh --stdin       scopes for a file list on stdin, one path per line
#   ./scripts/ci_scopes.sh --help
#
# See:
# - docs/ops/spec.md — the scopes, what each needs, and why a path selects the ones it does

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

MODE=""
for arg in "$@"; do
  case "$arg" in
    --all)     MODE="all" ;;
    --stdin)   MODE="stdin" ;;
    --help|-h) usage ;;
    --*)       die "Unknown option: ${arg}. Try --help." ;;
    *)
      [[ -z "$MODE" ]] || die "Give one base ref, --all or --stdin — not more than one."
      MODE="base" ; BASE_REF="$arg" ;;
  esac
done
[[ -n "$MODE" ]] || die "Name a base ref (origin/main), or pass --all or --stdin. See --help."

scripts=false; docs=false; backend=false; frontend=false; ops=false; images=false; format=false
all() { scripts=true; docs=true; backend=true; frontend=true; ops=true; images=true; format=true; }

if [[ "$MODE" == "all" ]]; then
  all
else
  if [[ "$MODE" == "stdin" ]]; then
    files="$(cat)"
  else
    base="$(git merge-base "$BASE_REF" HEAD)" || die "No merge base between '${BASE_REF}' and HEAD."
    files="$(git diff --name-only "$base" HEAD)"
  fi
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    case "$f" in
      # The gate itself, or the pipeline that runs it: prove everything.
      .github/workflows/*) all ;;
      # An action in this repository is pipeline code exactly as a workflow is, and it must be
      # matched BEFORE the .github/* arm below — which would otherwise map it to docs alone, so the
      # images job it exists to serve would never run on a change to it.
      .github/actions/*) all ;;
      scripts/*.sh) all ;;
      # check_docs.py is the docs gate itself. Prettier has no Python parser, so this arm withholds
      # `format`; the generic scripts/ arm below carries it for the .mjs and .json files it does
      # format.
      scripts/check_docs.py) scripts=true; docs=true ;;
      # Markdown anywhere — including inside fl_frontend/ and fl_backend/ — is prose: the docs
      # gate and the formatter check it, and no test tier can say anything about it.
      *.md) docs=true; format=true ;;
      scripts/*) scripts=true; docs=true; format=true ;;
      # Packaging inputs. The docs scope rides along because a comment in any of these is
      # documentation, and INC-6 holds one to the citations a spec sheet carries — withhold `docs`
      # and a comment-only edit here runs no documentation gate at all.
      fl_frontend/Dockerfile|fl_frontend/.dockerignore) images=true; docs=true ;;
      fl_backend/Dockerfile|fl_backend/.dockerignore) images=true; docs=true ;;
      fl_frontend/src/core/config.ts|fl_frontend/src/core/auth.ts|fl_frontend/src/instrumentation.ts)
        frontend=true; images=true; docs=true ;;
      # next.config.ts owns output:"standalone" and the file tracing the image copies;
      # pnpm-workspace.yaml owns the build-scripts policy the in-image install obeys. Both can
      # break only the image while the host build stays green.
      fl_frontend/package.json|fl_frontend/pnpm-lock.yaml|fl_frontend/next.config.ts|fl_frontend/pnpm-workspace.yaml)
        frontend=true; images=true ;;
      fl_backend/pyproject.toml|fl_backend/uv.lock) backend=true; images=true ;;
      # The published API surface, which the frontend's contract test reads (ADR-0033). It selects
      # the frontend scope too: a change confined to fl_backend/ would otherwise never run the check
      # comparing a Pydantic model against its Zod mirror.
      fl_backend/openapi.json) backend=true; frontend=true; docs=true ;;
      fl_frontend/*) frontend=true; docs=true ;;
      fl_backend/*) backend=true; docs=true ;;
      # The ops scope parses the compose files and runs nginx against prod.conf; prettier also
      # formats them (`fl_frontend/package.json`). Both carry `docs`, because their comments are
      # documentation (INC-6).
      docker-compose.yml|docker-compose.local.yml) ops=true; docs=true; format=true ;;
      nginx/*) ops=true; docs=true ;;
      .prettierignore) format=true ;;
      # .gitattributes decides line endings at checkout, which is exactly what the scripts' CRLF
      # self-check exists to catch on a fresh clone.
      .gitattributes) scripts=true ;;
      # No automated check exists for these. A deliberate, named list — anything NOT named here
      # falls through to the conservative default below.
      certs/*|.gitignore|LICENSE|NOTICE) ;;
      docs/*) docs=true; format=true ;;
      # The assistant hooks are shell scripts selfcheck.sh lints and probes, so a hook edit selects
      # the scripts scope — matched before the .claude/* arm, which would map it to docs and leave
      # the hook probes unrun on exactly the change that needs them.
      .claude/hooks/*) scripts=true; docs=true; format=true ;;
      .claude/*|.github/*) docs=true; format=true ;;
      *) all ;;
    esac
  done <<< "$files"
fi

printf 'scripts=%s\ndocs=%s\nbackend=%s\nfrontend=%s\nops=%s\nimages=%s\nformat=%s\n' \
  "$scripts" "$docs" "$backend" "$frontend" "$ops" "$images" "$format"
info "scopes: scripts=$scripts docs=$docs backend=$backend frontend=$frontend ops=$ops images=$images format=$format" >&2
