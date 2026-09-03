#!/usr/bin/env bash
# PreToolUse hook on Edit|Write|NotebookEdit — a write to docs/_standard/standard.md asks the owner first.
# The standard defines how every other document is written and checked, so a quiet edit changes the
# rules everything else is held to. A payload whose target cannot be read asks too.

ask() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This edits docs/_standard/standard.md — the documentation standard changes only with your explicit sign-off (owner rule, 2026-08-08). Approve to let this one write through, or deny and discuss the change first."}}'
  exit 0
}

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
# Not being in a repository is an answer — nothing here to protect. git MISSING is not, and a gate
# that falls silent on it is one in name only. A present git failing for another reason still
# exits: that state has already broken the session.
[ -n "$repo_root" ] || command -v git >/dev/null 2>&1 || ask
[ -n "$repo_root" ] || exit 0

# Containment on canonical paths, for `.claude/hooks/guard-branch.sh`'s reasons: `./` segments, `..`
# re-entry, doubled separators and Windows device prefixes all name the same file while sharing no
# useful prefix with the literal folder path.

# The backticks in the embedded comments are Markdown.
# shellcheck disable=SC2016
decision="$(REPO_ROOT="$repo_root" node -e '
const path = require("path");

let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const verdict = (() => {
    let raw;
    try {
      const input = JSON.parse(s).tool_input || {};
      // `notebook_path` as well as `file_path`: NotebookEdit names its target differently.
      raw = input.file_path || input.notebook_path;
    } catch {
      return "ask";
    }
    if (typeof raw !== "string" || raw === "") return "ask";

    const strip = (p) => p.replace(/^[\\/]{2}[?.][\\/]/, "");
    const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

    const standard = path.resolve(strip(process.env.REPO_ROOT), "docs", "_standard", "standard.md");
    const target = path.resolve(strip(raw));

    // The standard is one file, so containment is equality — folded, Windows paths being case-blind.
    return fold(target) === fold(standard) ? "ask" : "allow";
  })();

  process.stdout.write(verdict);
});
' 2>/dev/null)"

# Anything but an explicit "allow" asks — which covers node being absent and node crashing.
[ "$decision" = "allow" ] || ask

exit 0
