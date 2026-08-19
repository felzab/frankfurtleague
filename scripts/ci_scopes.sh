#!/usr/bin/env bash
#
# SCRIPTS · map the changed paths of a branch to verify.sh scopes.
#
# Prints one `name=true|false` line per scope on stdout, the shape `$GITHUB_OUTPUT` accepts, and the
# summary on stderr where it cannot leak into the outputs. Arms are matched most-specific-first and
# a path no arm recognises turns every scope on, so a new kind of file can never skip validation.
#
#   ./scripts/ci_scopes.sh origin/main   scopes for the diff against the merge base with that ref
#   ./scripts/ci_scopes.sh --all         every scope true — a push to main proves everything
#   ./scripts/ci_scopes.sh --stdin       scopes for a file list on stdin, one path per line
#   ./scripts/ci_scopes.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

MODE=""; FIRST_ARG=""
# Guarded in every mode arm, not the base-ref one alone: otherwise `ci_scopes.sh origin/main --all`
# silently discards the ref while the same two arguments the other way round die.
one_mode() { [[ -z "$MODE" ]] || die "Give one base ref, --all or --stdin — not more than one ('${FIRST_ARG}' and then '${1}')."; FIRST_ARG="$1"; }

for arg in "$@"; do
  case "$arg" in
    --all)     one_mode "$arg"; MODE="all" ;;
    --stdin)   one_mode "$arg"; MODE="stdin" ;;
    --help|-h) usage ;;
    --*)       die "Unknown option: ${arg}. Try --help." ;;
    *)         one_mode "$arg"; MODE="base"; BASE_REF="$arg" ;;
  esac
done
[[ -n "$MODE" ]] || die "Name a base ref (origin/main), or pass --all or --stdin. See --help."

scripts=false; docs=false; backend=false; format=false; frontend=false; ops=false; db=false; images=false
all() { scripts=true; docs=true; backend=true; format=true; frontend=true; ops=true; db=true; images=true; }

if [[ "$MODE" == "all" ]]; then
  all
else
  if [[ "$MODE" == "stdin" ]]; then
    files="$(cat)"
  else
    base="$(git merge-base "$BASE_REF" HEAD)" || die "No merge base between '${BASE_REF}' and HEAD."
    # `core.quotepath=false` because git otherwise quotes and octal-escapes a non-ASCII path, and the
    # quoted spelling matches no arm below — every scope turns on for a file only prettier reads.
    files="$(git -c core.quotepath=false diff --name-only "$base" HEAD)"
  fi
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue

    # The throwaway directories verify.sh and selfcheck.sh build and reclaim. A leftover from an
    # interrupted run is litter, not a change, and the fallback below would refuse the next run.
    case "$f" in .tmp-*) continue ;; esac

    # An extension question, not a directory one, so it is answered once here: prettier has no parser
    # for python, shell, TOML, a Dockerfile or an nginx config, and a job booted for those proves
    # nothing.
    case "$f" in
      *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.css|*.scss|*.md|*.mdx|*.yml|*.yaml|*.html)
        format=true ;;
    esac

    case "$f" in
      # The gate itself, or the pipeline that runs it: prove everything.
      .github/workflows/*) all ;;
      # An action is pipeline code as a workflow is, and must be matched BEFORE the .github/* arm,
      # which would map it to docs alone and never run the images job it exists to serve.
      .github/actions/*) all ;;
      scripts/*.sh) all ;;
      # The gate's own python and the ruff configuration governing it: the scripts scope lints,
      # types and drives them, and their comments are documentation like any other (INC-6).
      scripts/*.py|scripts/*.toml) scripts=true; docs=true ;;
      # Markdown anywhere — including inside fl_frontend/ and fl_backend/ — is prose: the docs
      # gate and the formatter check it, and no test tier can say anything about it.
      *.md) docs=true ;;
      scripts/*) scripts=true; docs=true ;;
      # Packaging inputs. `docs` rides along because a comment in any of these is documentation
      # (INC-6), and withholding it means a comment-only edit runs no documentation gate at all.
      fl_frontend/Dockerfile|fl_frontend/.dockerignore) images=true; docs=true ;;
      fl_backend/Dockerfile|fl_backend/.dockerignore) images=true; docs=true ;;
      fl_frontend/src/core/config.ts|fl_frontend/src/core/auth.ts|fl_frontend/src/instrumentation.ts)
        frontend=true; images=true; docs=true ;;
      # next.config.ts owns output:"standalone" and the file tracing the image copies;
      # pnpm-workspace.yaml owns the build-scripts policy the in-image install obeys. Both can
      # break only the image while the host build stays green.
      fl_frontend/package.json|fl_frontend/pnpm-lock.yaml|fl_frontend/next.config.ts|fl_frontend/pnpm-workspace.yaml)
        frontend=true; images=true; docs=true ;;
      # `db` is emitted wherever `backend` is: the db tier is that same suite behind a marker. A line
      # of its own, so CI and `check_scope.py` read this vocabulary rather than translating it.
      fl_backend/pyproject.toml|fl_backend/uv.lock) backend=true; db=true; images=true; docs=true ;;
      # The published API surface. It selects the frontend scope too, or a change confined to
      # fl_backend/ would never run the check comparing a Pydantic model against its Zod mirror.
      fl_backend/openapi.json) backend=true; db=true; frontend=true; docs=true ;;
      # prettier's configuration and its ignore file decide what the format scope proves, so a change
      # to either is a change to that scope — and to nothing else, the build reading neither.
      .prettierignore|*/.prettierignore|.prettierrc.json|*/.prettierrc.json) format=true ;;
      fl_frontend/*) frontend=true; docs=true ;;
      fl_backend/*) backend=true; db=true; docs=true ;;
      # The ops scope parses the compose files and runs nginx against prod.conf; prettier also formats
      # them. Both carry `docs`, their comments being documentation (INC-6).
      docker-compose.yml|docker-compose.local.yml) ops=true; docs=true ;;
      nginx/*) ops=true; docs=true ;;
      # .gitattributes decides line endings at checkout, which is exactly what the scripts' CRLF
      # self-check exists to catch on a fresh clone.
      .gitattributes) scripts=true ;;
      # No automated check exists for these. A deliberate, named list — anything NOT named here
      # falls through to the conservative default below.
      certs/*|.gitignore|LICENSE|NOTICE) ;;
      docs/*) docs=true ;;
      # selfcheck.sh lints and probes these, so a hook edit selects the scripts scope — matched before
      # the .claude/* arm, which would leave the hook probes unrun on the change that needs them.
      .claude/hooks/*) scripts=true; docs=true ;;
      # Shell under the same lint, building no image: without this arm a commit-msg edit reaches the
      # fallback and runs the whole matrix.
      .githooks/*) scripts=true; docs=true ;;
      .claude/*|.github/*) docs=true ;;
      *) all ;;
    esac
  done <<< "$files"
fi

# This stdout is `$GITHUB_OUTPUT`'s format, so a section heading or a fold marker in it is a corrupt
# mapping rather than a nicer log.
printf 'scripts=%s\ndocs=%s\nbackend=%s\nformat=%s\nfrontend=%s\nops=%s\ndb=%s\nimages=%s\n' \
  "$scripts" "$docs" "$backend" "$format" "$frontend" "$ops" "$db" "$images"
info "scopes: scripts=$scripts docs=$docs backend=$backend format=$format frontend=$frontend ops=$ops db=$db images=$images" >&2
