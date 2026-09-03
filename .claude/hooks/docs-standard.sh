#!/usr/bin/env bash
# PreToolUse hook on Edit|Write — slices the Spine out of docs/standard.md before a
# documentation-shaped write, small enough to arrive inline, and names both documents to read.
# It informs rather than protects, so failure is silence.

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || exit 0

standard="$repo_root/docs/standard.md"
[ -f "$standard" ] || exit 0

# node rather than jq: jq is not installed on the dev machine.
REPO_ROOT="$repo_root" STANDARD_PATH="$standard" EXAMPLES_PATH="$repo_root/docs/worked-examples.md" node -e '
const fs = require("fs");
const path = require("path");

// From one heading to the next of its level: the payload is the file sliced, never a summary of
// it, because a summary is a second home for a rule and the one that goes stale.
const section = (text, heading) => {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "## " + heading);
  if (start === -1) return "";
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  return [lines[start], ...(end === -1 ? rest : rest.slice(0, end))].join("\n").trim();
};

// A bold span opening with a figure and the word words, attributed to the rule line above it. The
// banned-words span in COR-4 opens with neither, which is what keeps it out.
const bounds = (text) => {
  const found = [];
  let rule = "";
  for (const line of text.split("\n")) {
    const opening = line.match(/^- \*\*([A-Z]{3}-\d+):\*\*/);
    if (opening) rule = opening[1];
    const bound = line.match(/\*\*((?:\d+|[a-z]+) words\b[^*]*)\*\*/);
    if (bound && rule !== "") found.push(rule + " — " + bound[1]);
  }
  return found;
};

let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let j;
  try {
    j = JSON.parse(s);
  } catch {
    return;
  }
  const input = j.tool_input || {};
  const raw = input.file_path;
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

  let text;
  try {
    text = fs.readFileSync(process.env.STANDARD_PATH, "utf8");
  } catch {
    return;
  }

  let examples = false;
  try {
    examples = fs.existsSync(process.env.EXAMPLES_PATH);
  } catch {}

  const spine = section(text, "Spine");
  const measured = bounds(text);

  // A renamed heading empties the slice, so the paths carry the payload alone rather than the hook
  // going quiet at the moment it is most needed.
  const read =
    "Read docs/standard.md" +
    (examples ? " and docs/worked-examples.md" : "") +
    " in full at " +
    (examples ? "those paths" : "that path") +
    " before writing.";
  // Named from what is actually being sent: a preamble promising a slice that failed to load is
  // worse than the bare paths, because a writer stops looking for what it says is already here.
  const sent = [];
  if (spine !== "") sent.push("one section of it, sliced at runtime");
  if (measured.length !== 0) sent.push("the bounds it sets");
  const preamble =
    "The write about to happen is documentation — a repository markdown file, or source comments — " +
    "so docs/standard.md binds it. " +
    (sent.length !== 0 ? "Below: " + sent.join(" and ") + "; the rest of it is not here. " : "Nothing of it is quoted below. ") +
    read;

  const parts = [preamble];
  if (spine !== "") parts.push(spine);
  if (measured.length !== 0) parts.push(["The bounds, from the same file:", ...measured].join("\n"));

  // The event is echoed rather than written in, so this output stays right wherever the
  // registration puts the script; the fallback names the event it is registered on today.
  const event =
    typeof j.hook_event_name === "string" && j.hook_event_name !== "" ? j.hook_event_name : "PreToolUse";

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: event,
        additionalContext: parts.join("\n\n"),
      },
    }),
  );
});
' 2>/dev/null

exit 0
