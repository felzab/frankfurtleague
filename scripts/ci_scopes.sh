#!/usr/bin/env bash
#
# scripts/ci_scopes.sh — map the changed paths of a branch to verify.sh scopes.
# TARGET PLATFORM: any (the CI runner is the consumer; it runs identically on a dev machine, which
# is how the mapping is tested by hand).
#
# Prints one `name=true|false` line per scope to stdout — scripts, docs, backend, frontend, ops,
# images, format — exactly the shape `$GITHUB_OUTPUT` accepts. The human-readable summary goes to stderr so
# it can never leak into the outputs. Both workflows consume this: verify.yml turns each line into
# a job condition, and codeql.yml reads the frontend and backend lines to pick analysis languages.
# Keeping the mapping here rather than inline in a workflow makes it one copy, testable by hand,
# and covered by selfcheck.sh and shellcheck like every other script.
#
# HOW IT DECIDES, most specific arm first; a file may light up several scopes. The mapping errs
# conservative — a path no arm recognises turns every scope on, so a new kind of file can never
# silently skip validation. Only the deliberate no-check list runs nothing.
#
# USAGE:
#   ./scripts/ci_scopes.sh origin/main   scopes for the diff between HEAD and its merge base
#                                        with the named ref
#   ./scripts/ci_scopes.sh --all         every scope true — a push to main proves everything
#   ./scripts/ci_scopes.sh --stdin       scopes for a file list read from stdin, one path per line,
#                                        instead of one computed from a diff. scripts/check_scope.py
#                                        uses this to ask the same mapping about a list it has
#                                        already filtered, so there is still only one copy of it
#   ./scripts/ci_scopes.sh --help

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
      # check_docs.py is the docs gate; anything else in scripts/ is documentation the
      # self-check and prettier both cover.
      scripts/check_docs.py) scripts=true; docs=true ;;
      # Markdown anywhere — including inside fl_frontend/ and fl_backend/ — is prose: the docs
      # gate and the formatter check it, and no test tier can say anything about it.
      *.md) docs=true; format=true ;;
      scripts/*) scripts=true; docs=true; format=true ;;
      # Packaging inputs. The docs scope rides along wherever source comments are scanned for
      # citations (.ts/.tsx/.js/.mjs/.cjs/.py — see check_docs.py, INC-6).
      fl_frontend/Dockerfile|fl_frontend/.dockerignore) images=true ;;
      fl_backend/Dockerfile|fl_backend/.dockerignore) images=true ;;
      fl_frontend/src/core/config.ts|fl_frontend/src/core/auth.ts|fl_frontend/src/instrumentation.ts)
        frontend=true; images=true; docs=true ;;
      # next.config.ts owns output:"standalone" and the file tracing the image copies;
      # pnpm-workspace.yaml owns the build-scripts policy the in-image install obeys. Both can
      # break only the image while the host build stays green.
      fl_frontend/package.json|fl_frontend/pnpm-lock.yaml|fl_frontend/next.config.ts|fl_frontend/pnpm-workspace.yaml)
        frontend=true; images=true ;;
      fl_backend/pyproject.toml|fl_backend/uv.lock) backend=true; images=true ;;
      # The published API surface, which the frontend's contract test reads (ADR-0040). It must select
      # the FRONTEND scope as well as the backend's, and that is the whole reason the document is
      # committed: a change confined to fl_backend/ selects the backend scope alone, so a Pydantic model
      # edit would otherwise never run the check that compares it against the Zod mirror. Regenerating
      # the document is what carries the model change into the frontend job.
      fl_backend/openapi.json) backend=true; frontend=true; docs=true ;;
      fl_frontend/*) frontend=true; docs=true ;;
      fl_backend/*) backend=true; docs=true ;;
      # The ops scope parses the compose files and runs nginx against prod.conf; prettier also
      # formats the compose files (see `format` in fl_frontend/package.json).
      docker-compose.yml|docker-compose.local.yml) ops=true; format=true ;;
      nginx/*) ops=true ;;
      .prettierignore) format=true ;;
      # .gitattributes decides line endings at checkout, which is exactly what the scripts' CRLF
      # self-check exists to catch on a fresh clone.
      .gitattributes) scripts=true ;;
      # No automated check exists for these. A deliberate, named list — anything NOT named here
      # falls through to the conservative default below.
      certs/*|.vscode/*|.gitignore|LICENSE|NOTICE) ;;
      docs/*) docs=true; format=true ;;
      # The assistant hooks are shell scripts selfcheck.sh lints and probes, so a hook edit selects
      # the scripts scope — matched before the .claude/* arm, which alone would map it to docs and
      # leave the one check that executes hooks unrun on exactly the change that needs it.
      .claude/hooks/*) scripts=true; docs=true; format=true ;;
      .claude/*|.github/*) docs=true; format=true ;;
      *) all ;;
    esac
  done <<< "$files"
fi

printf 'scripts=%s\ndocs=%s\nbackend=%s\nfrontend=%s\nops=%s\nimages=%s\nformat=%s\n' \
  "$scripts" "$docs" "$backend" "$frontend" "$ops" "$images" "$format"
info "scopes: scripts=$scripts docs=$docs backend=$backend frontend=$frontend ops=$ops images=$images format=$format" >&2
