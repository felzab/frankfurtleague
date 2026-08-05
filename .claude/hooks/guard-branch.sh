#!/usr/bin/env bash
#
# PreToolUse hook on Edit|Write|NotebookEdit — refuses a write INTO THE REPOSITORY while HEAD is `main`.
#
# WHY THIS IS A HOOK AND NOT A CLAUDE.md RULE:
#   `main` is protected and takes changes only through a PR, but nothing announces a mistake at the
#   moment it is made: `git checkout -b` carries the working tree over, so editing on `main` is free
#   and invisible right up until the push is rejected. CLAUDE.md states the rule; only a hook can
#   make it impossible to skip.
#
# WHY IT LOOKS AT THE PATH:
#   CLAUDE.md §2 exempts "a task that writes no tracked file — answering, reading, or writing only to
#   the scratchpad", and guard-branch-bash.sh has always honoured that for shell writes. Deciding by
#   the repository boundary rather than by a list of blessed directories keeps the two guards saying
#   the same thing, and covers the scratchpad, the system temp directory and the plan file a planning
#   session writes before it is allowed to branch — without naming any of them.
#
# CONTRACT: prints nothing and exits 0 on any branch but `main`, and on `main` for a target outside
# the working tree. Otherwise it prints the deny JSON the PreToolUse event understands, which stops
# the tool call before it writes.
#
#   WHAT IT DOES WHEN IT CANNOT TELL. Three questions decide the answer, and each has a "no idea"
#   case: which branch HEAD is on, where the repository root is, and which file the tool is about to
#   write. **git failing to answer either of the first two, and a payload naming no path, all deny** —
#   a hole in this guard costs more than a false refusal, and a false refusal is one
#   `git checkout -b` away from resolved. So does node being absent, since the path comparison runs
#   there.
#
#   A DETACHED HEAD IS ALLOWED, and that is the one "cannot tell" case that is not a refusal.
#   `git branch --show-current` prints nothing and succeeds when no branch is checked out, which is a
#   real answer rather than a missing one: no branch is checked out, so `main` is not, and a commit
#   made there cannot advance it. Denying would instead break every write during a rebase or a bisect.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

deny() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this writes into the repository, and HEAD is main. main is protected and takes changes only through a PR. Create the topic branch BEFORE editing (CLAUDE.md 2) — any uncommitted work comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>. Writing to the scratchpad or another path outside the working tree is allowed on any branch."}}'
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

# Containment is decided by node, on CANONICAL paths, because every cheap textual test is wrong on
# some input a tool call can legitimately produce. `<parent>/./frankfurtleague/x.py`, a `..` segment,
# a doubled separator and the `//?/` and UNC spellings of a drive all name a file inside this
# repository while sharing no useful prefix with what `git rev-parse` prints. `path.resolve` collapses
# all of them; `path.relative` then answers containment without any prefix arithmetic.
#
# `..` as the first segment means the target climbed back out of the root, and an absolute result means
# the two are on different drives. Empty means the target IS the root, which is a directory and not a
# file, and is denied for the same reason a path that cannot be read is.
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
    if (path.isAbsolute(rel)) return "allow";
    return rel === ".." || rel.startsWith(".." + path.sep) ? "allow" : "deny";
  })();

  process.stdout.write(verdict);
});
' 2>/dev/null)"

# Anything but an explicit "allow" denies — which covers node being absent, node crashing, and a
# payload it could make no sense of.
[ "$decision" = "allow" ] || deny

exit 0
