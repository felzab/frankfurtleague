#!/usr/bin/env bash
#
# PostToolUse hook on Edit|Write — reports a `text-fluid-*` class in frontend source for correction.
# PostToolUse, so the write has already landed: the `{"decision":"block"}` payload sends the file
# back to be fixed, and refusing it was never on offer at this event.
#
# WHY THIS IS A HOOK:
#   The scale is spelled `fluid-sm` and lives outside Tailwind's `--text-*` namespace, so
#   `text-fluid-sm` is not a utility — it matches no rule, applies no size, and silently inherits
#   one. Nothing else in the toolchain catches it: tsc has no opinion on strings, and eslint's
#   `no-unknown-classes` does not see a class it cannot resolve to a source. A stale class copied
#   from an old commit or an LLM's memory would render at the wrong size with a green build.
#
# SCOPE: `fl_frontend/src/**/*.ts(x)` only. `globals.css` names the old spelling deliberately, to
# say never to use it, and must not trip this.
#
# CONTRACT: prints nothing and exits 0 unless the written file is in scope AND contains the string.
#
# TARGET PLATFORM: any (Git Bash on Windows). Uses node rather than jq — jq is not installed here,
# and node always is.

file="$(node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try {
    const j = JSON.parse(s);
    process.stdout.write(j.tool_input?.file_path || j.tool_response?.filePath || "");
  } catch {}
});
' 2>/dev/null)"

[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0

# Forward slashes, so the path test works whatever separator the tool reported.
normalised="${file//\\//}"

case "$normalised" in
  */fl_frontend/src/*.ts | */fl_frontend/src/*.tsx) ;;
  *) exit 0 ;;
esac

if grep -q 'text-fluid-' "$file"; then
  # The backticks are Markdown in the refusal copy, not substitution.
  # shellcheck disable=SC2016
  printf '%s' '{"decision":"block","reason":"This file contains `text-fluid-*`, which is not a utility. The type scale is spelled `fluid-sm`, never `text-fluid-sm` — the tokens live outside Tailwind --text-* so no such class is generated, and it applies no font size at all. Replace every occurrence with the `fluid-*` form."}'
fi

exit 0
