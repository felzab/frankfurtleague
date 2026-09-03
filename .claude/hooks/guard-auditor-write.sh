#!/usr/bin/env bash
# PreToolUse hook on Write|Edit|NotebookEdit, declared by `.claude/agents/cold-auditor.md`: refuses
# a write inside the repository. That agent's report is its final message rather than a file, so the
# `Write` grant reaches nothing it is asked for and this refusal is what the grant still buys: the
# tree stays read-only by mechanism, not by a brief.

deny() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: a cold-auditor agent makes no write inside the repository, and this path is inside it. Describe the finding in your report, which is your final message rather than a file; the coordinator applies fixes."}}'
  exit 0
}

# The root as git sees it from the working directory, as the other guards read it, so a probe run
# from a throwaway repository judges that repository.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || printf '%s' "${CLAUDE_PROJECT_DIR:-}")"
[ -n "$repo_root" ] || deny

# Containment is decided by node on canonical paths, never textually, as `.claude/hooks/guard-branch.sh`
# decides it.
# shellcheck disable=SC2016
verdict="$(REPO_ROOT="$repo_root" node -e '
const path = require("path");
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let raw;
  try {
    const input = JSON.parse(s).tool_input || {};
    raw = input.file_path || input.notebook_path;
  } catch {
    process.stdout.write("deny");
    return;
  }
  if (typeof raw !== "string" || raw === "") {
    process.stdout.write("deny");
    return;
  }
  const strip = (p) => p.replace(/^[\\/]{2}[?.][\\/]/, "");
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const rel = path.relative(fold(path.resolve(strip(process.env.REPO_ROOT))), fold(path.resolve(strip(raw))));
  const outside = rel !== "" && (path.isAbsolute(rel) || rel === ".." || rel.startsWith(".." + path.sep));
  process.stdout.write(outside ? "outside" : "deny");
});
' 2>/dev/null)"

[ "$verdict" = "outside" ] || deny
exit 0
