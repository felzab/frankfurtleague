#!/usr/bin/env bash
#
# scripts/ci_scopes.sh — map the changed paths of a branch to verify.sh scopes.
# TARGET PLATFORM: any (the CI runner is the consumer; it runs identically on a dev machine, which
# is how the mapping is tested by hand).
#
# Prints one `name=true|false` line per scope to stdout — scripts, docs, backend, frontend, images,
# format — exactly the shape `$GITHUB_OUTPUT` accepts. The human-readable summary goes to stderr so
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
#   ./scripts/ci_scopes.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

MODE=""
for arg in "$@"; do
  case "$arg" in
    --all)     MODE="all" ;;
    --help|-h) usage ;;
    --*)       die "Unknown option: ${arg}. Try --help." ;;
    *)
      [[ -z "$MODE" ]] || die "Give one base ref, or --all — not both."
      MODE="base" ; BASE_REF="$arg" ;;
  esac
done
[[ -n "$MODE" ]] || die "Name a base ref (origin/main), or pass --all. See --help."

scripts=false; docs=false; backend=false; frontend=false; images=false; format=false
all() { scripts=true; docs=true; backend=true; frontend=true; images=true; format=true; }

if [[ "$MODE" == "all" ]]; then
  all
else
  base="$(git merge-base "$BASE_REF" HEAD)" || die "No merge base between '${BASE_REF}' and HEAD."
  files="$(git diff --name-only "$base" HEAD)"
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue
    case "$f" in
      # The gate itself, or the pipeline that runs it: prove everything.
      .github/workflows/*) all ;;
      scripts/*.sh) all ;;
      # check_docs.py is the docs gate; anything else in scripts/ is documentation the
      # self-check and prettier both cover.
      scripts/check_docs.py) scripts=true; docs=true ;;
      # Markdown anywhere — including inside fl_frontend/ and fl_backend/ — is prose: the docs
      # gate and the formatter check it, and no test tier can say anything about it.
      *.md) docs=true; format=true ;;
      scripts/*) scripts=true; docs=true; format=true ;;
      # Packaging inputs. The docs scope rides along wherever source comments are scanned for
      # citations (.ts/.tsx/.py — see check_docs.py, DS20).
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
      fl_frontend/*) frontend=true; docs=true ;;
      fl_backend/*) backend=true; docs=true ;;
      # Prettier's coverage reaches outside fl_frontend (see `format` in fl_frontend/package.json);
      # these change nothing else CI can check.
      docker-compose.yml|docker-compose.local.yml|.prettierignore) format=true ;;
      # .gitattributes decides line endings at checkout, which is exactly what the scripts' CRLF
      # self-check exists to catch on a fresh clone.
      .gitattributes) scripts=true ;;
      # No automated check exists for these. A deliberate, named list — anything NOT named here
      # falls through to the conservative default below.
      nginx/*|certs/*|.vscode/*|.gitignore|LICENSE|NOTICE) ;;
      docs/*) docs=true; format=true ;;
      .claude/*|.github/*) docs=true; format=true ;;
      *) all ;;
    esac
  done <<< "$files"
fi

printf 'scripts=%s\ndocs=%s\nbackend=%s\nfrontend=%s\nimages=%s\nformat=%s\n' \
  "$scripts" "$docs" "$backend" "$frontend" "$images" "$format"
info "scopes: scripts=$scripts docs=$docs backend=$backend frontend=$frontend images=$images format=$format" >&2
