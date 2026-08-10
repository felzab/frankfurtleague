#!/usr/bin/env bash
#
# SCRIPTS · test the scripts themselves.
#
# `bash -n` checks syntax only: a script can call a helper that does not exist and pass every syntax
# check, because that failure is discoverable at run time alone. Run this after touching anything in
# `scripts/` or in `.claude/hooks/`, whose shell it lints and whose guards it probes. Each check
# announces itself with a `step` title, so what runs is the run's own output rather than a copy here
# that can disagree with it.
#
#   ./scripts/selfcheck.sh
#
# See:
# - docs/ops/spec.md — the gate this feeds, and the script conventions it holds them to

source "$(dirname "${BASH_SOURCE[0]}")/_lib.sh"

RUNNABLE=(local.sh verify.sh publish.sh deploy.sh ci_scopes.sh)
FAILURES=0
note_fail() { warn "$*"; FAILURES=$(( FAILURES + 1 )); }

step "1. Syntax"
# `.claude/hooks/*.sh` included: nothing else parses them, and a hook that does not parse fails on
# the session it was meant to guard.
for f in scripts/*.sh .claude/hooks/*.sh; do
  if bash -n "$f" 2>/dev/null; then info "$(basename "$f")"; else note_fail "$(basename "$f") does not parse"; fi
done

step "2. Line endings are LF"
# A shell script with CRLF fails outright on Linux — `/usr/bin/env bash^M: bad interpreter` — and
# deploy.sh runs on the Linux server, so this is not cosmetic.

# `.gitattributes` (`* text=auto eol=lf`) means git stores LF and a fresh Linux checkout is safe, but
# a file copied directly, or an editor writing CRLF, bypasses it. Windows tolerates CRLF, so the
# defect is invisible on the machine that introduces it.

# `tr` is byte-oriented and interprets the escape itself, so no carriage return appears in this file.
# Two alternatives fail a known-CRLF fixture: MSYS awk strips CR on input, and grepping for a
# literal CR puts that character into the detector.
for f in scripts/*.sh .claude/hooks/*.sh; do
  if [[ -n "$(tr -dc '\r' < "$f")" ]]; then
    note_fail "$(basename "$f") has CRLF endings. Fix:  tr -d '\r' < $f > t && mv t $f && chmod +x $f"
  else
    info "$(basename "$f")"
  fi
done

step "3. Executable bit is set in git"
# Checks the mode git records, not the filesystem's: on Windows core.fileMode is false, so `chmod +x`
# in Git Bash is cosmetic and git keeps storing 100644 — the script then reaches the Linux server
# non-executable and `./scripts/deploy.sh` fails.

# Invisible on Windows, because bash runs a non-executable file when you name the interpreter.
# Fix:  git update-index --chmod=+x scripts/<name>.sh
# _lib.sh is excluded: it is sourced, never executed.
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

step "4. Every helper called is defined"
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
# Captured into a variable first: `script | grep -q …` is wrong here, because `set -o pipefail` fails
# a pipeline if any stage failed and the script under test is supposed to exit non-zero. Capturing
# separates the exit status from what the script said.
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
  # Header only: take the contiguous comment block and STOP at the first line of code. A fixed line
  # range would reach the case statement and compare the code against itself.
  doc="$(awk 'NR>1 { if ($0 !~ /^#/) exit; print }' "scripts/$f" | grep -oE -- '--[a-z-]+' | sort -u | tr '\n' ' ')"
  code="$(grep -oE '^[[:space:]]+--[a-z|[:space:]-]+\)' "scripts/$f" | tr -d ' )' | tr '|' '\n' | grep -oE -- '--[a-z-]+' | sort -u | tr '\n' ' ')"
  if [[ "$doc" == "$code" ]]; then
    info "$f"
  else
    note_fail "$f: --help documents [${doc}] but the code accepts [${code}]"
  fi
done

step "9. shellcheck"
# SC1091 is excluded throughout: shellcheck cannot follow the sourced `scripts/_lib.sh`. SC2034 is
# annotated at the line rather than excluded globally, so a new unused-looking assignment justifies
# itself where it is written.
run_shellcheck() {
  if command -v shellcheck >/dev/null 2>&1; then
    shellcheck -e SC1091 "$@"
    return
  fi
  # No local binary: the official image, which is how shellcheck is reachable on a Windows dev
  # machine. MSYS_NO_PATHCONV stops Git Bash rewriting the container path into a Windows one.
  if docker version >/dev/null 2>&1; then
    MSYS_NO_PATHCONV=1 docker run --rm -v "/${REPO_ROOT}:/mnt" -w /mnt \
      koalaman/shellcheck:stable -e SC1091 "$@"
    return
  fi
  return 2
}

sc_out=""; sc_rc=0
sc_out="$(run_shellcheck scripts/*.sh .claude/hooks/*.sh 2>&1)" || sc_rc=$?
case "$sc_rc" in
  0) info "no findings in any script" ;;
  2) info "unavailable (no local binary and no Docker) — skipped" ;;
  *) note_fail "shellcheck reported findings:"; printf '%s\n' "$sc_out" | head -40 | detail ;;
esac

step "10. actionlint on the workflows"
# actionlint validates a workflow's expressions, job graph, action inputs and embedded shell — the
# class of bug that otherwise surfaces on the first live run. The availability ladder check 9 uses:
# local binary, else the pinned Docker image, else skip.
run_actionlint() {
  if command -v actionlint >/dev/null 2>&1; then
    actionlint
    return
  fi
  if docker version >/dev/null 2>&1; then
    # 1.7.8 is the floor: earlier versions reject `using: node24`, which GitHub documents and
    # supports. Nothing bumps this automatically — dependabot's github-actions ecosystem covers
    # `uses:` references, and this is a `docker run`.
    MSYS_NO_PATHCONV=1 docker run --rm -v "/${REPO_ROOT}:/repo" -w /repo rhysd/actionlint:1.7.12
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
# check_scope.py decides whether a change to a packaging path is a documentation change, and a wrong
# answer is silent: classify a real code change as comments and the image build never runs before the
# push.

# These fixtures pin both directions, including the two cases a line-level rule gets wrong — a `//`
# inside a string literal, and a Dockerfile, which is never classified at all (ADR-0030).

# The fixtures sit under the repo root and are passed as relative paths: MSYS rewrites an absolute
# POSIX path such as mktemp's into a Windows one the interpreter cannot open (`scripts/README.md`).
classifier="$(any_python || true)"
if [[ -z "$classifier" ]]; then
  info "no python found — skipped"
else
  fixtures=".tmp-scope-fixtures"
  rm -rf "$fixtures"; mkdir -p "$fixtures"
  trap 'rm -rf "${REPO_ROOT}/.tmp-scope-fixtures"' EXIT

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
  # The TypeScript half is the only one needing a toolchain, and neither node nor the frontend's
  # typescript is a prerequisite of this scope: `--scripts` stays runnable on a clone that has never
  # run pnpm install.

  # So where typescript does not resolve the classifier is required to answer "code", and that
  # degradation is asserted rather than left to read as a pass.
  if node scripts/ts_normalize.mjs "$fixtures/comment.old.ts" "$fixtures/comment.old.ts" >/dev/null 2>&1; then
    expect_verdict comment  ts         comment-only
  else
    info "typescript does not resolve here — asserting the safe degradation, not the real answer"
    expect_verdict comment  ts         code
  fi
  expect_verdict code       ts         code
  expect_verdict comment    py         comment-only
  expect_verdict code       py         code
  # Not a gap: a `#` in a Dockerfile heredoc is not a comment, so it is never classified at all.
  expect_verdict dockerfile Dockerfile code

  rm -rf "$fixtures"
  trap - EXIT
fi

step "12. The branch, compose and rules-index hooks refuse what they exist to refuse"
# A guard is the code whose failure nobody observes: a refusal that does not happen announces
# nothing, and so does an exemption that swallows too much. These probes run a hook the way the
# runner does — a JSON payload on stdin, the verdict on stdout.

# The guards go against a throwaway repository whose branch, .gitignore and index each case controls;
# the rules-index hook goes against this repository, whose index it serves.

# The throwaway repo sits under the repo root for the same MSYS reason as the classifier fixtures: an
# absolute /tmp path is rewritten into a Windows one before bash can use it.
if ! command -v node >/dev/null 2>&1; then
  info "node not found — skipped (without node the hooks deny by contract, and there is nothing to probe)"
else
  hooks_dir="${REPO_ROOT}/.claude/hooks"
  hookfx=".tmp-hook-fixtures"
  rm -rf "$hookfx"; mkdir -p "$hookfx/repo"
  trap 'rm -rf "${REPO_ROOT}/.tmp-hook-fixtures"' EXIT

  # The fixture carries a .gitignore and a tracked file because the exemption is decided by asking
  # git both questions: a repository with neither answers "not ignored, not tracked" to every path,
  # which proves nothing.
  if (
    cd "$hookfx/repo" &&
    git init -q -b main &&
    mkdir -p docs/audit src &&
    printf 'docs/audit/\n' > .gitignore &&
    printf 'x\n' > src/tracked.py &&
    printf 'y\n' > docs/audit/tracked-note.md &&
    git add -A &&
    git add -f docs/audit/tracked-note.md &&
    git -c user.email=selfcheck@example.invalid -c user.name=selfcheck commit -q -m seed
  ); then
    # The root AS THE HOOK SEES IT: it asks git from its working directory, so the probes must
    # build their payloads from the same answer rather than from a path this script composed.
    hook_root="$(cd "$hookfx/repo" && git rev-parse --show-toplevel)"

    run_hook() { # $1 hook basename · $2 payload on stdin — from inside the throwaway repo
      ( cd "$hookfx/repo" && printf '%s' "$2" | bash "${hooks_dir}/$1" 2>/dev/null ) || true
    }
    expect_deny() { # $1 label · $2 hook output
      case "$2" in
        *'"permissionDecision":"deny"'*) info "$1 — denied" ;;
        *) note_fail "$1: expected a deny, got '${2:-nothing}'" ;;
      esac
    }
    expect_allow() { # $1 label · $2 hook output — the contract is silence
      if [[ -z "$2" ]]; then info "$1 — allowed"; else note_fail "$1: expected silence, got '$2'"; fi
    }
    file_payload() { printf '{"tool_input":{"file_path":"%s"}}' "$1"; }
    cmd_payload()  { printf '{"tool_input":{"command":"%s"}}' "$1"; }

    # guard-branch.sh on main: a write inside the repository is refused however the path is spelt,
    # and every cheap textual containment test lets at least one spelling through. The device form
    # is Windows-only, because elsewhere it is not an absolute path.
    expect_deny  "branch guard: plain inside path"   "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/inside.py")")"
    expect_deny  "branch guard: ./ segment"          "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/./inside.py")")"
    expect_deny  "branch guard: .. re-entry"         "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/sub/../inside.py")")"
    expect_deny  "branch guard: doubled separator"   "$(run_hook guard-branch.sh "$(file_payload "${hook_root}//inside.py")")"
    case "$(uname -s)" in
      MINGW*|MSYS*|CYGWIN*)
        expect_deny "branch guard: //?/ device form"  "$(run_hook guard-branch.sh "$(file_payload "//?/${hook_root}/inside.py")")" ;;
    esac
    expect_deny  "branch guard: payload without a path" "$(run_hook guard-branch.sh '{"tool_input":{}}')"
    expect_deny  "branch guard: unparseable payload"    "$(run_hook guard-branch.sh 'not json')"
    expect_allow "branch guard: path outside the repo"  "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/../outside.py")")"

    # The gitignore exemption, still on main: ignored AND untracked is CLAUDE.md 2's "writes no
    # tracked file", which is what lets the audit commands write their reports with no branch step.
    expect_allow "branch guard: gitignored, untracked" "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/docs/audit/report.md")")"
    expect_allow "branch guard: gitignored subdir"     "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/docs/audit/2026/report.md")")"
    expect_deny  "branch guard: tracked file"          "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/src/tracked.py")")"
    # The force-added file is the case a reader expects to be exempt and is not: `git check-ignore`
    # reports a tracked path as not ignored, so it refuses on the first half already.
    expect_deny  "branch guard: ignored but tracked"   "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/docs/audit/tracked-note.md")")"

    # The credential override, checked before the exemption and beating it. Nothing is written: the
    # hook decides from the payload, so a name is all a probe needs. The last case is a DIRECTORY.
    for cred in .env .env.local server.pem id_rsa credentials.json kubeconfig .env.d/note.md; do
      expect_deny "branch guard: ${cred} under a gitignored dir" \
        "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/docs/audit/${cred}")")"
    done

    # The same guard off main: a topic branch allows, and so does a detached HEAD — a rebase or a
    # bisect must not lose every write.
    ( cd "$hookfx/repo" && git checkout -q -b probe-topic )
    expect_allow "branch guard: topic branch"        "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/inside.py")")"
    ( cd "$hookfx/repo" && git checkout -q --detach )
    expect_allow "branch guard: detached HEAD"       "$(run_hook guard-branch.sh "$(file_payload "${hook_root}/inside.py")")"
    ( cd "$hookfx/repo" && git checkout -q main )

    # guard-branch-bash.sh: the same rule for shell writes. The scratchpad and /tmp are exempt, and
    # `git checkout -b` is the escape hatch that must never be blocked.
    expect_deny  "bash guard: redirect on main"      "$(run_hook guard-branch-bash.sh "$(cmd_payload 'echo x > notes.md')")"
    expect_allow "bash guard: plain read"            "$(run_hook guard-branch-bash.sh "$(cmd_payload 'cat notes.md')")"
    expect_allow "bash guard: /tmp write"            "$(run_hook guard-branch-bash.sh "$(cmd_payload 'echo x > /tmp/scratch.txt')")"
    expect_allow "bash guard: the escape hatch"      "$(run_hook guard-branch-bash.sh "$(cmd_payload 'git checkout -b fix-thing')")"
    ( cd "$hookfx/repo" && git checkout -q probe-topic )
    expect_allow "bash guard: redirect off main"     "$(run_hook guard-branch-bash.sh "$(cmd_payload 'echo x > notes.md')")"
    ( cd "$hookfx/repo" && git checkout -q main )

    # guard-local-compose.sh: a bare compose is refused, naming the local file is what allows it.
    expect_deny  "compose guard: bare docker compose" "$(run_hook guard-local-compose.sh "$(cmd_payload 'docker compose up -d')")"
    expect_allow "compose guard: local file named"    "$(run_hook guard-local-compose.sh "$(cmd_payload 'docker compose -f docker-compose.local.yml up -d')")"
    expect_allow "compose guard: not compose at all"  "$(run_hook guard-local-compose.sh "$(cmd_payload 'docker ps')")"
  else
    note_fail "could not build the throwaway repository for the hook probes"
  fi

  # docs-rules-index.sh is the one informational hook, and both directions fail silently: one that
  # stops emitting never shows the standard to a session, one that stops staying quiet restates a
  # page of rules on every edit.

  # Probed from the repo root, because the index it serves is this repository's, under throwaway
  # session ids cleaned up below.
  rules_hook="${REPO_ROOT}/.claude/hooks/docs-rules-index.sh"
  probe_rules() { # $1 payload on stdin — from the repository root
    printf '%s' "$1" | bash "$rules_hook" 2>/dev/null || true
  }
  expect_silent() { # $1 label · $2 hook output — the contract is silence
    if [[ -z "$2" ]]; then info "$1 — silent"; else note_fail "$1: expected silence, got '$2'"; fi
  }
  rules_md_payload()  { printf '{"session_id":"%s","tool_input":{"file_path":"%s","content":"x"}}' "$1" "$2"; }
  rules_src_payload() { printf '{"session_id":"%s","tool_input":{"file_path":"%s","new_string":"const a = 1;"}}' "$1" "$2"; }

  # The root as the hook sees it: the hook asks git, git prints the Windows spelling, and a payload
  # built from the MSYS spelling in REPO_ROOT resolves to a different drive inside node.
  rules_root="$(git -C "$REPO_ROOT" rev-parse --show-toplevel 2>/dev/null)"
  sid="sc-$$"
  out="$(probe_rules "$(rules_md_payload "$sid" "${rules_root}/docs/README.md")")"
  case "$out" in
    *hookSpecificOutput*) info "rules hook: first repo .md edit — emitted" ;;
    *) note_fail "rules hook: expected the index on a first repo .md edit, got '${out:-nothing}'" ;;
  esac
  expect_silent "rules hook: same session again"    "$(probe_rules "$(rules_md_payload "$sid" "${rules_root}/docs/README.md")")"
  expect_silent "rules hook: comment-free source"   "$(probe_rules "$(rules_src_payload "${sid}-b" "${rules_root}/fl_frontend/src/probe.ts")")"
  expect_silent "rules hook: path outside the repo" "$(probe_rules "$(rules_md_payload "${sid}-c" "${rules_root}/../outside.md")")"
  rm -f "$(node -e 'process.stdout.write(require("os").tmpdir())')"/claude-docs-rules-index-sc-* 2>/dev/null || true
fi

printf '\n'
if (( FAILURES == 0 )); then
  ok "All script self-checks passed."
else
  die "${FAILURES} script self-check(s) failed."
fi
