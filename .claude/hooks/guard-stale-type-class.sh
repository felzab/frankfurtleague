#!/usr/bin/env bash
# PostToolUse hook on Edit|Write — sends back a `fl_frontend/src` file carrying a `text-fluid-*`
# class. The scale is spelled `fluid-sm` and sits outside Tailwind's `--text-*` namespace, so the
# prefixed spelling matches no rule and applies no size while tsc, eslint and the build all stay
# green. A stylesheet is read the same way: the class is as dead inside an `@apply` or a selector
# as it is in a className, and neither the build nor the linters see it there either.

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

# Source only, and read per language: a stylesheet comment is prose, where globals.css names the
# dead spelling to say never to write it, and that sentence stays writable. TypeScript is read
# whole.
case "$normalised" in
  */fl_frontend/src/*.ts | */fl_frontend/src/*.tsx)
    body="$(cat "$file")"
    ;;
  */fl_frontend/src/*.css)
    body="$(node -e '
const fs = require("fs");
try {
  process.stdout.write(fs.readFileSync(process.argv[1], "utf8").replace(/\/\*[\s\S]*?\*\//g, ""));
} catch {}
' "$file" 2>/dev/null)"
    ;;
  *) exit 0 ;;
esac

case "$body" in
  *text-fluid-*)
    # The backticks are Markdown in the refusal copy, not substitution.
    # shellcheck disable=SC2016
    printf '%s' '{"decision":"block","reason":"This file contains `text-fluid-*`, which is not a utility. The type scale is spelled `fluid-sm`, never `text-fluid-sm` — the tokens live outside Tailwind --text-* so no such class is generated, and it applies no font size at all. In a stylesheet it is equally dead: `@apply text-fluid-sm` and a `.text-fluid-sm` selector both match a rule that was never emitted. Replace every occurrence with the `fluid-*` form. A CSS comment naming the dead spelling is allowed, and is how globals.css records the trap."}'
    ;;
esac

exit 0
