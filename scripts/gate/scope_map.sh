#!/usr/bin/env bash
#
# SCRIPTS · map the changed paths of a branch to verify.sh scopes.
#
# Prints one `name=true|false` line per scope on stdout, the shape `$GITHUB_OUTPUT` accepts, and the
# summary on stderr where it cannot leak into the outputs. Arms are matched most-specific-first and
# a path no arm recognises turns every scope on, so a new kind of file can never skip validation.
#
#   ./scripts/gate/scope_map.sh origin/main   scopes for the diff against the merge base with that ref
#   ./scripts/gate/scope_map.sh --all         every scope true — a push to main proves everything
#   ./scripts/gate/scope_map.sh --stdin       scopes for a file list on stdin, one path per line
#   ./scripts/gate/scope_map.sh --help

source "$(dirname "${BASH_SOURCE[0]}")/../lib/_lib.sh"

MODE=""; FIRST_ARG=""
# Guarded in every mode arm, not the base-ref one alone: otherwise `scope_map.sh origin/main --all`
# silently discards the ref while the same two arguments the other way round are refused.

# `refuse`, not `die`, here and below: a mapping this could not produce is an input nobody can act
# on as a finding, and `scripts/lib/checker_kernel.py`'s contract spells that 2 rather than 1.
one_mode() { [[ -z "$MODE" ]] || refuse "Give one base ref, --all or --stdin — not more than one ('${FIRST_ARG}' and then '${1}')."; FIRST_ARG="$1"; }

for arg in "$@"; do
  case "$arg" in
    --all)     one_mode "$arg"; MODE="all" ;;
    --stdin)   one_mode "$arg"; MODE="stdin" ;;
    --help|-h) usage ;;
    --*)       refuse "Unknown option: ${arg}. Try --help." ;;
    *)         one_mode "$arg"; MODE="base"; BASE_REF="$arg" ;;
  esac
done
[[ -n "$MODE" ]] || refuse "Name a base ref (origin/main), or pass --all or --stdin. See --help."

scripts=false; docs=false; backend=false; format=false; frontend=false; ops=false; db=false; images=false
all() { scripts=true; docs=true; backend=true; format=true; frontend=true; ops=true; db=true; images=true; }

if [[ "$MODE" == "all" ]]; then
  all
else
  if [[ "$MODE" == "stdin" ]]; then
    files="$(cat)"
  else
    base="$(git merge-base "$BASE_REF" HEAD)" || refuse "No merge base between '${BASE_REF}' and HEAD."
    # `core.quotepath=false` because git otherwise quotes and octal-escapes a non-ASCII path, and the
    # quoted spelling matches no arm below — every scope turns on for a file only prettier reads.

    # `--no-renames` because a detected rename is one filepair printing the DESTINATION alone:
    # renaming fl_frontend/Dockerfile away would then ask for no image build.
    files="$(git -c core.quotepath=false diff --no-renames --name-only "$base" HEAD)"
  fi
  while IFS= read -r f; do
    [[ -n "$f" ]] || continue

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
      # selfcheck.sh looks for the script each hook registration here names, so an edit that drops
      # or renames one is proven by the scripts scope rather than by the session it fails.
      .claude/settings.json) scripts=true; docs=true ;;
      # Markdown anywhere — including inside fl_frontend/ and fl_backend/ — is prose: the docs
      # gate and the formatter check it, and no test tier can say anything about it.
      *.md) docs=true ;;
      scripts/*) scripts=true; docs=true ;;
      # Packaging inputs. `docs` rides along because a comment in any of these is documentation
      # (INC-6), and withholding it means a comment-only edit runs no documentation gate at all.
      fl_frontend/Dockerfile|fl_frontend/.dockerignore) images=true; docs=true ;;
      # `scripts` too, that being the scope `scripts/gate/selfcheck.sh` runs in: nothing else
      # compares this file's `FROM ghcr.io/astral-sh/uv:` tag with `fl_backend/pyproject.toml`'s
      # `required-version`. A bot's bump touches this file alone, and the whole scripts scope is
      # what that costs.
      fl_backend/Dockerfile) images=true; docs=true; scripts=true ;;
      # Its own arm, the uv comparison above reading the Dockerfile alone: joined to it, an edit
      # here would buy the whole scripts scope for a file nothing outside the build reads.
      fl_backend/.dockerignore) images=true; docs=true ;;
      # Its own arm, ahead of the three below it: the mirror register reads this module's text for
      # the internal key's alphabet, so it owes the backend scope as well as the image's.
      fl_frontend/src/core/config.ts)
        frontend=true; images=true; backend=true; db=true; docs=true ;;
      # The frontend's db-tier files drive these against a real replica set, so each owes the db
      # scope (`docs/frontend/spec.md` §1.9); the patch also ships in the image.
      fl_frontend/src/core/auth.ts|fl_frontend/patches/*)
        frontend=true; images=true; db=true; docs=true ;;
      # What a db-tier file imports directly, or `test:db`'s command line loads, owes the scope that
      # runs it (`scripts/tests/test_scope_decisions.py` derives the set). A module reached only
      # through one of these waits for the push to main.
      fl_frontend/src/core/passkeyRefusal.ts|fl_frontend/src/features/passkeys/actions.ts| \
      fl_frontend/src/core/authDoubles.ts|fl_frontend/src/shared/utils/refusal.ts| \
      fl_frontend/app-source-maps.mjs|fl_frontend/tsconfig-alias-hook.mjs| \
      fl_frontend/worker-exit-reporter.mjs)
        frontend=true; db=true; docs=true ;;
      # Every extension `test:db` collects, so no db-tier file changes outside the scope that runs it.
      fl_frontend/*.db.test.cjs|fl_frontend/*.db.test.mjs|fl_frontend/*.db.test.js| \
      fl_frontend/*.db.test.cts|fl_frontend/*.db.test.mts|fl_frontend/*.db.test.ts)
        frontend=true; db=true; docs=true ;;
      # Its own arm, apart from config.ts's above: joined to it, an edit here would buy the whole
      # backend and database tier for a file no backend suite reads.
      fl_frontend/src/instrumentation.ts)
        frontend=true; images=true; docs=true ;;
      # pnpm-workspace.yaml owns the build-scripts policy the in-image install obeys, which can break
      # only the image while the host build stays green. The manifests and the lockfile also pin
      # what the db-tier files start their server with.
      fl_frontend/package.json|fl_frontend/pnpm-lock.yaml|fl_frontend/pnpm-workspace.yaml)
        frontend=true; images=true; db=true; docs=true ;;
      # next.config.ts owns output:"standalone" and the file tracing the image copies, which can
      # break only the image while the host build stays green.
      fl_frontend/next.config.ts)
        frontend=true; images=true; docs=true ;;
      # `db` is emitted wherever `backend` is: the db tier is that same suite behind a marker. A line
      # of its own, so CI reads this vocabulary rather than translating it.

      # `scripts` rides along because `scripts/ruff.toml` EXTENDS this pyproject and the gate's own
      # ruff and pyright come out of the virtualenv this lockfile pins: both govern that scope
      # without living in it.
      fl_backend/pyproject.toml|fl_backend/uv.lock) scripts=true; backend=true; db=true; images=true; docs=true ;;
      # Every scope running the virtualenv this file pins, and the image's builder stage. The frontend
      # and images jobs take a bare interpreter from it for the step pool alone, where a low pin
      # costs the pool, never a verdict.
      fl_backend/.python-version) scripts=true; docs=true; backend=true; ops=true; db=true; images=true ;;
      # The published API surface. It selects the frontend scope too, or a change confined to
      # fl_backend/ would never run the check comparing a Pydantic model against its Zod mirror.
      fl_backend/openapi.json) backend=true; db=true; frontend=true; docs=true ;;
      # Each is read as source text by the frontend suites as they load, so a change confined to
      # fl_backend/ would otherwise reach the assertions over it no earlier than the push to main.
      fl_backend/app/core/recording.py| \
      fl_backend/app/shared/schemas/bounds.py| \
      fl_backend/app/shared/schemas/custom.py|fl_backend/app/api/bewerbungen/admin_router.py| \
      fl_backend/app/api/bewerbungen/services.py|fl_backend/app/api/saisons/schemas.py| \
      fl_backend/app/api/saisons/services.py| \
      fl_backend/app/core/collections.py|fl_backend/app/core/constraints.py| \
      fl_backend/tests/shared/address_lines.json|fl_backend/tests/shared/email_addresses.json)
        backend=true; db=true; frontend=true; docs=true ;;
      # prettier's configuration and its ignore file decide what the format scope proves, so a change
      # to either is a change to that scope — and to nothing else, the build reading neither.
      .prettierignore|*/.prettierignore|.prettierrc.json|*/.prettierrc.json) format=true ;;
      # The bounds and patterns `fl_backend/tests/shared/test_frontend_mirrors.py` compares are
      # retyped by hand in these modules, so a diff editing the frontend side of a mirror would
      # otherwise reach that comparison no earlier than the push to main.
      fl_frontend/src/shared/schemas.ts|fl_frontend/src/core/emailAddress.ts| \
      fl_frontend/src/features/bewerbungen/constants.ts| \
      fl_frontend/src/features/teams/constants.ts|fl_frontend/src/features/spiele/constants.ts| \
      fl_frontend/src/features/saisons/constants.ts|fl_frontend/src/features/saisons/schemas.ts| \
      fl_frontend/src/features/saisons/shapeOffer.ts|fl_frontend/src/features/bewerbungen/schemas.ts| \
      fl_frontend/src/features/aktionen/constants.ts|fl_frontend/src/features/spieler/schemas.ts| \
      fl_frontend/src/features/spiele/schemas.ts|fl_frontend/src/features/spiele/utils.ts| \
      fl_frontend/src/features/bewerbungen/zustellung.ts|fl_frontend/src/core/logFormat.ts| \
      fl_frontend/src/core/trace.ts|fl_frontend/src/features/sperrliste/constants.ts| \
      fl_frontend/src/features/schiedsrichter/constants.ts| \
      fl_frontend/src/features/registrierungen/constants.ts| \
      fl_frontend/src/core/objectId.ts|fl_frontend/src/features/sperrliste/schemas.ts)
        frontend=true; backend=true; db=true; docs=true ;;
      # `fl_backend/tests/api/test_rules_refusal_mirror.py` cuts one refusal's `case` out of the
      # module below and asserts over the German inside, so a renamed refusal code or a reworded
      # phrase would reach that comparison no earlier than the push to main.
      fl_frontend/src/features/saisons/refusals.ts| \
      fl_frontend/src/features/saisons/components/forms/AdminSaisonEditForm/FormRegelnSection.tsx)
        frontend=true; backend=true; db=true; docs=true ;;
      # `fl_backend/tests/core/test_request_deadline.py` holds the backend's request deadline under
      # this module's fetch ceiling, so a raised or lowered ceiling would otherwise reach that
      # comparison no earlier than the push to main.
      fl_frontend/src/core/api.ts) frontend=true; backend=true; db=true; docs=true ;;
      fl_frontend/*) frontend=true; docs=true ;;
      # The db tier's image is named here, and `fl_frontend/src/core/mongoImage.test.ts` holds the
      # frontend's db-tier files to it, so a bump here owes the frontend scope too.
      fl_backend/tests/conftest.py) backend=true; db=true; frontend=true; docs=true ;;
      fl_backend/*) backend=true; db=true; docs=true ;;
      # The ops scope parses the compose files and runs nginx over both edges; prettier also formats
      # them. Both carry `docs`, their comments being documentation (INC-6).
      docker-compose.yml|docker-compose.local.yml) ops=true; docs=true ;;
      # `fl_frontend/src/core/edgeRedaction.ts` reads this file's redaction map for the frontend
      # suites that build a link, so an edit here owes the frontend scope too.
      nginx/shared/http.conf) ops=true; docs=true; frontend=true ;;
      nginx/*) ops=true; docs=true ;;
      # .gitattributes decides line endings at checkout, which is exactly what the scripts' CRLF
      # self-check exists to catch on a fresh clone.

      # `docs` too: `scripts/checks/docs_gate/checks.py` reads this file for its `line-endings` check and
      # for the exemption it defines as the `binary` macro's expansion, so editing it moves what
      # that scope proves.
      .gitattributes) scripts=true; docs=true ;;
      # `.gitignore` decides which paths the documentation gate scans and which citations it
      # excuses (`scripts/checks/docs_gate/kernel.py :: is_gitignored`), so widening it narrows what
      # --docs proves while nothing else reads the widening.
      .gitignore) docs=true ;;
      # `scripts/tests/test_check_gate_budget.py` parses this file itself and drives every budgeted
      # row red and green, so the scripts scope is what proves an edit here; ahead of the
      # `.github/*` arm, which would map it to `docs` alone.
      .github/gate-wall-clock.tsv) scripts=true; docs=true ;;
      # NOTICE is read whole by the documentation gate and by nothing else
      # (`scripts/checks/docs_gate/kernel.py :: PROSE_FILENAMES`), so an edit to it selects that
      # scope alone: a dead asset path written there fails on the branch that wrote it.
      NOTICE) docs=true ;;
      # No automated check exists for these. A deliberate, named list — anything NOT named here
      # falls through to the conservative default below.
      certs/*|LICENSE) ;;
      docs/*) docs=true ;;
      # selfcheck.sh lints and probes these, so a hook edit selects the scripts scope — matched before
      # the .claude/* arm, which would leave the hook probes unrun on the change that needs them.
      .claude/hooks/*) scripts=true; docs=true ;;
      # Shell under the same lint, building no image: without this arm a commit-msg edit reaches the
      # fallback and runs the whole matrix.
      .githooks/*) scripts=true; docs=true ;;
      # zizmor audits this file under `--strict-collection`, and the ops scope is the one running
      # zizmor; ahead of the `.github/*` arm, which would map it to `docs` alone.
      .github/dependabot.yml) ops=true; docs=true ;;
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
