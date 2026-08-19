#!/usr/bin/env bash
# PreToolUse hook on Edit|Write|NotebookEdit — refuses a write to a tracked file while HEAD is `main`.
# The exemption is asked of git rather than kept as a list of blessed directories, so a path
# gitignored tomorrow is covered without editing this file. Every "cannot tell" here denies.

deny() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this writes a tracked file, and HEAD is main. main is protected and takes changes only through a PR. Create the topic branch BEFORE editing (CLAUDE.md 2) — any uncommitted work comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>. Allowed on any branch: a path outside the working tree such as the scratchpad, and a gitignored untracked path inside it such as docs/audit/ — except a credential-shaped name, which is refused here whatever .gitignore says."}}'
  exit 0
}

# Status kept apart from the output: a detached HEAD succeeds with no branch name, which is a real
# answer, while git missing or no repository fails. Denying a detached HEAD would break every write
# during a rebase.
branch="$(git branch --show-current 2>/dev/null)"
branch_status=$?

if [ "$branch_status" -eq 0 ]; then
  [ "$branch" = "main" ] || exit 0
else
  # git could not answer, so fall through: `repo_root` below is empty and denies.
  :
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || deny

# Containment is decided by node on canonical paths, never textually.

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
      // NotebookEdit names its target `notebook_path`; reading `file_path` alone would deny every
      // notebook edit anywhere rather than the ones in the repository.
      raw = input.file_path || input.notebook_path;
    } catch {
      return "deny";
    }
    if (typeof raw !== "string" || raw === "") return "deny";

    // `path.resolve` keeps a Windows long-path or UNC-device prefix rather than normalising it
    // away, so it is stripped before anything else looks at the path.
    const strip = (p) => p.replace(/^[\\/]{2}[?.][\\/]/, "");

    const root = path.resolve(strip(process.env.REPO_ROOT));
    const target = path.resolve(strip(raw));

    // `path.relative` compares segments literally, so Windows needs the fold to see two spellings
    // of one path as one.
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

# Ahead of the exemption below, because a credential file is gitignored by design. Matched on every
# segment so a directory carrying the name is caught: the leading slash lets `*/name` mean any
# segment, the first included.

# `service-account` is unanchored, as in the shell guards: the name around it is arbitrary
# (`gcp-service-account.json`), so anchoring would refuse a narrower set.
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
