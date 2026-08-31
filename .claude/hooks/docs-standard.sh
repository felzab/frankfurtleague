#!/usr/bin/env bash
# PostToolUse hook on Edit|Write — emits docs/standard.md once per session, on the
# first documentation-shaped edit, tracked by a sentinel named for the session id.
# Unlike the guards it informs rather than protects, so every failure here is silence, never a block.

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || exit 0

standard="$repo_root/docs/standard.md"
[ -f "$standard" ] || exit 0

# node rather than jq: jq is not installed on the dev machine.
REPO_ROOT="$repo_root" STANDARD_PATH="$standard" node -e '
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

  // Canonicalise before comparing: a dot segment, a doubled separator or a Windows device prefix
  // each name a file inside the repository while sharing no prefix with what git printed.
  const strip = (p) => p.replace(/^[\\/]{2}[?.][\\/]/, "");
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);
  const root = fold(path.resolve(strip(process.env.REPO_ROOT)));
  const rel = path.relative(root, fold(path.resolve(strip(raw))));
  if (rel === "" || path.isAbsolute(rel) || rel === ".." || rel.startsWith(".." + path.sep)) return;

  // An edit that writes no comment marker wrote no documentation.
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
  const sentinel = path.join(os.tmpdir(), "claude-docs-standard-" + sid.replace(/[^A-Za-z0-9-]/g, "_"));
  if (fs.existsSync(sentinel)) return;

  let text;
  try {
    text = fs.readFileSync(process.env.STANDARD_PATH, "utf8");
  } catch {
    return;
  }
  try {
    fs.writeFileSync(sentinel, "");
  } catch {
    // Without the sentinel the standard repeats on every edit, which costs more than never showing it.
    return;
  }

  const preamble =
    "The edit just written is documentation — a repository markdown file, or source comments — " +
    "so docs/standard.md binds it. The standard follows — a rule is one list line or one " +
    "section, and the section governing what you are writing is the one to read before " +
    "writing more. This appears once per session.";
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
