#!/usr/bin/env bash
#
# PreToolUse hook on Edit|Write|NotebookEdit — refuses a write to a TRACKED FILE while HEAD is `main`.
#
# WHY THIS IS A HOOK AND NOT A CLAUDE.md RULE:
#   `main` is protected and takes changes only through a PR, but nothing announces a mistake at the
#   moment it is made: `git checkout -b` carries the working tree over, so editing on `main` is free
#   and invisible right up until the push is rejected. CLAUDE.md states the rule; only a hook can
#   make it impossible to skip.
#
# WHY IT LOOKS AT THE PATH:
#   CLAUDE.md §2 exempts "a task that writes no tracked file — answering, reading, or writing only to
#   the scratchpad", and guard-branch-bash.sh honours that for shell writes. What decides it here
#   names no directory. The repository boundary covers the scratchpad, the system temp
#   directory and the plan file a planning session writes before it is allowed to branch. Inside the
#   repository, a path git reports as ignored AND untracked is the same exemption by the same words —
#   which is what lets `/audit:*` and `/docs:audit` write their reports into gitignored `docs/audit/`
#   with no branch step, the exception CLAUDE.md §1 names. Asking git rather than carrying a list of
#   blessed directories means a path gitignored tomorrow is covered without editing this file.
#
# CREDENTIAL SHAPES ARE CHECKED FIRST AND BEAT THE EXEMPTION:
#   `.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `credentials.json`, `kubeconfig`, a name carrying
#   `service-account`, and anything under a `certs/` directory are refused inside the repository
#   whatever `.gitignore` says. The same list is carried by guard-branch-bash.sh and
#   guard-branch-powershell.sh, so no route is weaker than another for the same name; it also covers
#   what `settings.json` denies the Read, Write and Edit tools. This is not a credential control —
#   that deny list and CLAUDE.md §1 are, and this hook is silent on every branch but `main`. It is
#   the exemption above declining to swallow the one class of file whose whole purpose is to be
#   gitignored.
#
# CONTRACT: prints nothing and exits 0 on any branch but `main`; on `main`, for a target outside the
# working tree, and for an ignored, untracked, non-credential-shaped target inside it. Otherwise it
# prints the deny JSON the PreToolUse event understands, which stops the tool call before it writes.
#
#   WHAT IT DOES WHEN IT CANNOT TELL. Every question below has a "no idea" case, and every one of
#   them denies — git unable to answer, node absent, a payload naming no path.
#
#   A DETACHED HEAD IS ALLOWED, and that is the one "cannot tell" case that is not a refusal.
#   `git branch --show-current` prints nothing and succeeds when no branch is checked out, which is a
#   real answer rather than a missing one: no branch is checked out, so `main` is not, and a commit
#   made there cannot advance it. Denying would instead break every write during a rebase or a bisect.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

deny() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this writes a tracked file, and HEAD is main. main is protected and takes changes only through a PR. Create the topic branch BEFORE editing (CLAUDE.md 2) — any uncommitted work comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>. Allowed on any branch: a path outside the working tree such as the scratchpad, and a gitignored untracked path inside it such as docs/audit/ — except a credential-shaped name, which is refused here whatever .gitignore says."}}'
  exit 0
}

# Captured separately from the exit status, because the two "empty" cases are different answers: a
# detached HEAD succeeds with no output, while git missing or no repository here fails. Only the
# second is a question that could not be answered.
branch="$(git branch --show-current 2>/dev/null)"
branch_status=$?

if [ "$branch_status" -eq 0 ]; then
  # A real answer. Anything that is not `main` — a topic branch, or no branch at all — is allowed.
  [ "$branch" = "main" ] || exit 0
else
  # git could not answer. Fall through: `repo_root` below comes from the same git and will be empty,
  # so this denies rather than exiting 0 on a question nobody answered.
  :
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || deny

# Containment is decided by node on canonical paths, never textually. An inside verdict
# appends the repository-relative path on its own line, because the git questions below are asked
# about a path rather than about a boundary.

# The backticks are Markdown in the embedded script's own comments; nothing here is meant to expand.
# shellcheck disable=SC2016
decision="$(REPO_ROOT="$repo_root" node -e '
const path = require("path");

let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const verdict = (() => {
    let raw;
    try {
      const input = JSON.parse(s).tool_input || {};
      // `notebook_path` as well as `file_path`: NotebookEdit names its target differently, and reading
      // only one key would deny every notebook edit anywhere rather than the ones in the repository.
      raw = input.file_path || input.notebook_path;
    } catch {
      return "deny";
    }
    if (typeof raw !== "string" || raw === "") return "deny";

    // Windows long-path and UNC-device spellings of an ordinary drive path. `path.resolve` keeps the
    // prefix rather than normalising it away, so it is stripped before anything else looks at it.
    const strip = (p) => p.replace(/^[\\/]{2}[?.][\\/]/, "");

    const root = path.resolve(strip(process.env.REPO_ROOT));
    const target = path.resolve(strip(raw));

    // Case-folded on Windows, where two spellings of one path differ only in case and `path.relative`
    // compares the segments literally.
    const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
    const rel = path.relative(fold(root), fold(target));

    if (rel === "") return "deny";
    if (path.isAbsolute(rel)) return "outside";
    if (rel === ".." || rel.startsWith(".." + path.sep)) return "outside";

    // Re-derived unfolded and with forward slashes: git matches a pathspec as it is spelt, and the
    // folded copy above exists only to answer containment.
    return "inside\n" + path.relative(root, target).split(path.sep).join("/");
  })();

  process.stdout.write(verdict);
});
' 2>/dev/null)"

# Anything but an explicit verdict denies — which covers node being absent, node crashing, and a
# payload it could make no sense of.
verdict="$(printf '%s\n' "$decision" | head -n 1)"
rel_path="$(printf '%s\n' "$decision" | tail -n +2)"

if [ "$verdict" = "outside" ]; then
  exit 0
fi
[ "$verdict" = "inside" ] || deny
[ -n "$rel_path" ] || deny

# Matched on every segment, not only the basename, so a directory carrying the name is caught too.
# The leading slash is what lets one `*/name` pattern mean "any segment" including the first.

# `service-account` is unanchored, as it is in the shell guards: the name it sits inside is
# arbitrary — `gcp-service-account.json` — so an anchored pattern would refuse a narrower set here.
lower="$(printf '%s' "$rel_path" | tr '[:upper:]' '[:lower:]')"
case "/$lower" in
  */.env* | *.pem | *.key | *.p12 | */id_rsa* | */credentials.json* | */kubeconfig* | *service-account*) deny ;;
  # The one directory in the list, so it is matched as a whole segment: as a bare substring `certs/`
  # would refuse `my-certs/notes.md`, which carries no credential at all.
  */certs/*) deny ;;
esac

# Ignored AND untracked is CLAUDE.md §2's "writes no tracked file", asked of git rather than kept in
# a list here. Every other status falls through to the refusal: git failing to answer must not read
# as an exemption.
git -C "$repo_root" check-ignore -q -- "$rel_path" >/dev/null 2>&1
ignored=$?
git -C "$repo_root" ls-files --error-unmatch -- "$rel_path" >/dev/null 2>&1
tracked=$?

if [ "$ignored" -eq 0 ] && [ "$tracked" -eq 1 ]; then
  exit 0
fi

deny
