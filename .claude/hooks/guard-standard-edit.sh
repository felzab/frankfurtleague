#!/usr/bin/env bash
#
# PreToolUse hook on Edit|Write|NotebookEdit — a write into docs/_standard/ asks the owner first.
#
# WHY THIS IS A HOOK AND NOT A CLAUDE.md RULE:
#   docs/_standard/ defines how every other document is written and checked, so a quiet edit to it
#   changes the rules everything else is held to. The owner's instruction (2026-08-08) is that the
#   standard never changes without them knowing. A CLAUDE.md sentence states that; only a hook can
#   put the question on the screen at the moment of the edit.
#
# CONTRACT: prints nothing and exits 0 for a target outside docs/_standard/. For a target inside it
# — or for a payload whose target cannot be determined at all — it prints the "ask" JSON the
# PreToolUse event understands, which surfaces the owner's permission prompt instead of writing.
# Asking on the unreadable payload mirrors guard-branch.sh's fail-closed reasoning: a hole in the
# guard costs more than one extra question, and the cases are rare.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

ask() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This edits docs/_standard — the documentation standard changes only with your explicit sign-off (owner rule, 2026-08-08). Approve to let this one write through, or deny and discuss the change first."}}'
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

    const standard = path.resolve(strip(process.env.REPO_ROOT), "docs", "_standard");
    const target = path.resolve(strip(raw));
    const rel = path.relative(fold(standard), fold(target));

    // Empty means the target IS the folder; a relative result not climbing out means inside it.
    if (rel === "") return "ask";
    if (path.isAbsolute(rel)) return "allow";
    return rel === ".." || rel.startsWith(".." + path.sep) ? "allow" : "ask";
  })();

  process.stdout.write(verdict);
});
' 2>/dev/null)"

# Anything but an explicit "allow" asks — which covers node being absent and node crashing.
[ "$decision" = "allow" ] || ask

exit 0
