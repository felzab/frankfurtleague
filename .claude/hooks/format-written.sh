#!/usr/bin/env bash
# HOOKS · a file Claude wrote is formatted by Prettier as it lands
# PostToolUse hook on Edit and Write, the shape Claude Code's hooks guide gives for Prettier. The gate's
# format scope checks the same thing and never writes, so this hook is what keeps that scope green
# without a formatting commit. Silent and exit 0 wherever it cannot format: a hook error on a write
# that already happened would only be noise.

IFS= read -r -d '' payload || true

# The written file's absolute path, read by node, which every checkout here has and jq is not.
file="$(printf '%s' "$payload" | node -e '
let raw = "";
process.stdin.on("data", (d) => (raw += d)).on("end", () => {
  try {
    const path = JSON.parse(raw).tool_input?.file_path;
    if (typeof path === "string") process.stdout.write(path);
  } catch {}
});
' 2>/dev/null)" || exit 0
[[ -n "$file" && -f "$file" ]] || exit 0

# The checkout holding the file, which an agent's worktree is; a file outside one, such as a scratch
# file, is left alone.
root="$(git -C "${file%[/\\]*}" rev-parse --show-toplevel 2>/dev/null)" || exit 0
[[ -f "${root}/.prettierrc.json" && -f "${root}/.prettierignore" ]] || exit 0

# Prettier resolves the plugins `.prettierrc.json` names from the directory it runs in, so it runs from
# a frontend folder with its packages installed: the file's own checkout's, else this hook's own,
# since an agent's worktree may hold no install.
here="${BASH_SOURCE[0]%/*}"
[[ "$here" == "${BASH_SOURCE[0]}" ]] && here=.
frontend=""
for candidate in "${root}/fl_frontend" "${here}/../../fl_frontend"; do
  if [[ -f "${candidate}/node_modules/prettier/bin/prettier.cjs" ]]; then
    frontend="$candidate"
    break
  fi
done
[[ -n "$frontend" ]] || exit 0

# `--ignore-path` keeps the gate's exclusions, read relative to the file's own checkout, and
# `--ignore-unknown` skips a file Prettier has no parser for.
(cd "$frontend" && node node_modules/prettier/bin/prettier.cjs --write --log-level silent --ignore-unknown \
  --ignore-path "${root}/.prettierignore" "$file") </dev/null >/dev/null 2>&1
exit 0
