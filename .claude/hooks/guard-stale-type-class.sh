#!/usr/bin/env bash
# PostToolUse hook on Edit|Write — sends back a `fl_frontend/src` file carrying a `text-fluid-*` class.
# The scale is spelled `fluid-sm` and sits outside Tailwind's `--text-*` namespace, so the prefixed
# spelling matches no rule and applies no size while tsc, eslint and the build all stay green.

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

# Source only: `globals.css` names the old spelling deliberately, to say never to use it.
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
