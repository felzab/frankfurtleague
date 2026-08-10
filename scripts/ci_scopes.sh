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

MODE=""; FIRST_ARG=""
# Guarded in every mode arm rather than the base-ref one alone: with the guard only there,
# `ci_scopes.sh origin/main --all` silently discards the ref and answers a question nobody asked,
# while the same two arguments the other way round die.
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
    files="$(git diff --name-only "$base" HEAD)"
  fi
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue

    # The throwaway directories verify.sh and selfcheck.sh build and reclaim. A leftover from an
    # interrupted run is litter, not a change: through the fallback below, one file of it refuses
    # the next run in the name of an image nobody touched.
    case "$f" in .tmp-*) continue ;; esac

    # The formatter's reach is an extension question, not a directory one, so it is answered once
    # here rather than in every arm: prettier has no parser for python, shell, TOML, a Dockerfile
    # or an nginx config, and a job booted for those checks nothing.
    case "$f" in
      *.ts|*.tsx|*.mts|*.cts|*.js|*.jsx|*.mjs|*.cjs|*.json|*.jsonc|*.css|*.scss|*.md|*.mdx|*.yml|*.yaml|*.html)
        format=true ;;
    esac

    case "$f" in
      # The gate itself, or the pipeline that runs it: prove everything.
      .github/workflows/*) all ;;
      # An action in this repository is pipeline code exactly as a workflow is, and it must be
      # matched BEFORE the .github/* arm below — which would otherwise map it to docs alone, so the
      # images job it exists to serve would never run on a change to it.
      .github/actions/*) all ;;
      scripts/*.sh) all ;;
      # The gate's own python and the ruff configuration governing it: the scripts scope lints,
      # types and drives them, and their comments are documentation like any other (INC-6).
      scripts/*.py|scripts/*.toml) scripts=true; docs=true ;;
      # Markdown anywhere — including inside fl_frontend/ and fl_backend/ — is prose: the docs
      # gate and the formatter check it, and no test tier can say anything about it.
      *.md) docs=true ;;
      scripts/*) scripts=true; docs=true ;;
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
      # `db` is emitted wherever `backend` is: the db tier is that same suite behind a marker
      # (ADR-0023), so what breaks one can break the other. It is a line of its own so CI and
      # `check_scope.py` read this vocabulary rather than translating it.
      fl_backend/pyproject.toml|fl_backend/uv.lock) backend=true; db=true; images=true ;;
      # The published API surface, which the frontend's contract test reads (ADR-0033). It selects
      # the frontend scope too: a change confined to fl_backend/ would otherwise never run the check
      # comparing a Pydantic model against its Zod mirror.
      fl_backend/openapi.json) backend=true; db=true; frontend=true; docs=true ;;
      # What prettier may not read decides what the format scope proves, so a change to it is a
      # change to that scope — and to nothing else, the build reading none of it.
      .prettierignore|*/.prettierignore) format=true ;;
      fl_frontend/*) frontend=true; docs=true ;;
      fl_backend/*) backend=true; db=true; docs=true ;;
      # The ops scope parses the compose files and runs nginx against prod.conf; prettier also
      # formats them (`fl_frontend/package.json`). Both carry `docs`, because their comments are
      # documentation (INC-6).
      docker-compose.yml|docker-compose.local.yml) ops=true; docs=true ;;
      nginx/*) ops=true; docs=true ;;
      # .gitattributes decides line endings at checkout, which is exactly what the scripts' CRLF
      # self-check exists to catch on a fresh clone.
      .gitattributes) scripts=true ;;
      # No automated check exists for these. A deliberate, named list — anything NOT named here
      # falls through to the conservative default below.
      certs/*|.gitignore|LICENSE|NOTICE) ;;
      docs/*) docs=true ;;
      # The assistant hooks are shell scripts selfcheck.sh lints and probes, so a hook edit selects
      # the scripts scope — matched before the .claude/* arm, which would map it to docs and leave
      # the hook probes unrun on exactly the change that needs them.
      .claude/hooks/*) scripts=true; docs=true ;;
      # git's own hooks are shell under the same lint and the same probes, and they build no image:
      # without this arm they reach the fallback, and a commit-msg edit runs the whole matrix.
      .githooks/*) scripts=true; docs=true ;;
      .claude/*|.github/*) docs=true ;;
      *) all ;;
    esac
  done <<< "$files"
fi

# The chrome stops here. This stdout is `$GITHUB_OUTPUT`'s format, so a section heading or a fold
# marker in it is a corrupt mapping rather than a nicer log; the human line goes to stderr.
printf 'scripts=%s\ndocs=%s\nbackend=%s\nformat=%s\nfrontend=%s\nops=%s\ndb=%s\nimages=%s\n' \
  "$scripts" "$docs" "$backend" "$format" "$frontend" "$ops" "$db" "$images"
info "scopes: scripts=$scripts docs=$docs backend=$backend format=$format frontend=$frontend ops=$ops db=$db images=$images" >&2
