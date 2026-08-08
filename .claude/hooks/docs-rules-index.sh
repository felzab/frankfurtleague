#!/usr/bin/env bash
#
# PostToolUse hook on Edit|Write — serves docs/_standard/rules-index.md into the session's context
# after its first documentation edit.
#
# WHY THIS IS A HOOK:
#   The standard binds every documentation edit, but nothing guarantees a session has read it before
#   writing: CLAUDE.md can instruct, not enforce, and loading the whole standard into every session
#   would spend tokens on the majority of sessions that never touch documentation. This hook pays
#   only on demand — the first documentation-shaped edit puts the rules index into context, once,
#   and a session that edits no documentation pays nothing.
#
# WHAT COUNTS AS A DOCUMENTATION EDIT:
#   A markdown file inside this repository, or a source file inside it whose newly written content
#   carries a comment marker for its language — a comment is documentation (INC-6), so writing one
#   is the moment the rules start to apply. The index text is read from disk at emit time: the file
#   is the source and this hook is transport, so there is no copy to drift.
#
# CONTRACT: prints the PostToolUse additionalContext JSON on the session's first qualifying edit,
# and nothing otherwise. Once per session, tracked by a sentinel file in the system temp directory
# named for the session id. UNLIKE THE GUARDS, EVERY FAILURE HERE IS SILENCE: this hook informs
# rather than protects, so a broken payload, a missing index or an absent node must never block
# the tool call it rides on — the guards deny on doubt because a hole in a guard is a loss, and
# this hook stays quiet on doubt because a spurious page of rules in every session is one.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || exit 0

index="$repo_root/docs/_standard/rules-index.md"
[ -f "$index" ] || exit 0

REPO_ROOT="$repo_root" INDEX_PATH="$index" node -e '
const fs = require("fs");
const os = require("os");
const path = require("path");

let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let j;
  try {
    j = JSON.parse(s);
  } catch {
    return;
  }
  const input = j.tool_input || {};
  const raw = input.file_path || (j.tool_response || {}).filePath;
  if (typeof raw !== "string" || raw === "") return;

  // Containment on canonical paths, for the same reason guard-branch.sh decides it there: a dot
  // segment, a doubled separator or a Windows device prefix all name a file inside the repository
  // while sharing no useful prefix with what git printed. Outside the repository nothing is this
  // repository documentation, whatever its extension.
  const strip = (p) => p.replace(/^[\\/]{2}[?.][\\/]/, "");
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const root = fold(path.resolve(strip(process.env.REPO_ROOT)));
  const rel = path.relative(root, fold(path.resolve(strip(raw))));
  if (rel === "" || path.isAbsolute(rel) || rel === ".." || rel.startsWith(".." + path.sep)) return;

  // The new content is what decides whether a source edit is documentation: Edit carries it as
  // new_string, Write as content. An edit that writes no comment marker wrote no documentation.
  const fresh =
    typeof input.new_string === "string" ? input.new_string
    : typeof input.content === "string" ? input.content
    : "";
  const base = path.basename(rel).toLowerCase();
  const ext = path.extname(base);
  let isDocs = false;
  if (ext === ".md" || ext === ".mdx") {
    isDocs = true;
  } else if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].indexOf(ext) !== -1) {
    isDocs = fresh.indexOf("//") !== -1 || fresh.indexOf("/*") !== -1;
  } else if (ext === ".py") {
    isDocs = fresh.indexOf("#") !== -1 || fresh.indexOf("\"\"\"") !== -1;
  } else if ([".sh", ".bash", ".yml", ".yaml", ".toml", ".conf"].indexOf(ext) !== -1 || base.indexOf("dockerfile") !== -1) {
    isDocs = fresh.indexOf("#") !== -1;
  }
  if (!isDocs) return;

  const sid = typeof j.session_id === "string" && j.session_id !== "" ? j.session_id : "unknown";
  const sentinel = path.join(os.tmpdir(), "claude-docs-rules-index-" + sid.replace(/[^A-Za-z0-9-]/g, "_"));
  if (fs.existsSync(sentinel)) return;

  let text;
  try {
    text = fs.readFileSync(process.env.INDEX_PATH, "utf8");
  } catch {
    return;
  }
  try {
    fs.writeFileSync(sentinel, "");
  } catch {
    // With no sentinel the index would repeat on every edit, and a page of rules restated per
    // edit costs more attention than never showing it — so an unwritable temp directory is silence.
    return;
  }

  const preamble =
    "The edit just written is documentation — a repository markdown file, or source comments — " +
    "so docs/_standard/ binds it. The rules index follows, one line per rule; the full rules " +
    "live in docs/_standard/chapters/, and the chapter governing what you are writing is the " +
    "one to read before writing more. This appears once per session.";
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PostToolUse",
        additionalContext: preamble + "\n\n" + text,
      },
    }),
  );
});
' 2>/dev/null

exit 0
