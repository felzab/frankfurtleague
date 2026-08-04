#!/usr/bin/env bash
#
# PreToolUse hook on Bash — refuses a shell command that WRITES while HEAD is `main`.
#
# WHY THIS EXISTS SEPARATELY FROM guard-branch.sh:
#   That hook matches Edit|Write|NotebookEdit and stops those tools on `main`. It never sees a shell
#   redirect, `sed -i`, a heredoc or a `python -c` that writes — which are the same edit by another
#   route, and in practice the more common one. Guarding only the tools left the rule looking
#   enforced while the usual path around it stayed open.
#
# CONTRACT: prints nothing and exits 0 unless HEAD is `main` AND the command looks like it mutates a
# path inside the repo. Reads (`git log`, `grep`, `cat`) are untouched, and so are writes that
# clearly land outside the working tree.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

branch="$(git branch --show-current 2>/dev/null)"
[ "$branch" = "main" ] || exit 0

cmd="$(node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  try {
    process.stdout.write(JSON.parse(s).tool_input?.command || "");
  } catch {}
});
' 2>/dev/null)"

[ -n "$cmd" ] || exit 0

# Anything whose only writes land outside the working tree is fine on any branch: the scratchpad,
# the system temp dir, and the null device. Checked FIRST so a legitimate scratch write is never
# blocked by the pattern match below.
case "$cmd" in
  *"/dev/null"*) ;;
esac
case "$cmd" in
  *scratchpad* | */tmp/* | *"AppData/Local/Temp"*) exit 0 ;;
esac

# `git checkout -b` / `git switch -c` are how a session LEAVES main. Never block the escape hatch.
case "$cmd" in
  *"checkout -b"* | *"switch -c"*) exit 0 ;;
esac

# Write shapes, in the order they actually occur here.
#
# Matched against a SPACE-PREFIXED copy so a verb at the very start of the command is caught: the
# pattern for `rm` has to be " rm " to avoid matching inside a word, and `rm docs/x` has no leading
# space of its own.
padded=" $cmd"
writes=0
case "$padded" in
  *"sed -i"* | *"sed --in-place"*) writes=1 ;;
  *" tee "* | *"| tee"*)           writes=1 ;;
  *"write_bytes"* | *"write_text"* | *".writelines"*) writes=1 ;;
  *" >> "* | *" > "*)              writes=1 ;;
  *"git commit"* | *"git merge"* | *"git rebase"* | *"git apply"* | *"git restore"*) writes=1 ;;
  *" mv "* | *" cp "* | *" rm "* | *" mkdir "* | *" touch "*) writes=1 ;;
esac

[ "$writes" = "1" ] || exit 0

# A redirect into the null device only — nothing is written anywhere.
case "$cmd" in
  *">/dev/null"* | *"> /dev/null"*)
    case "$cmd" in
      *"sed -i"* | *" tee "* | *"write_bytes"* | *"write_text"* | *"git commit"*) ;;
      *) exit 0 ;;
    esac
    ;;
esac

printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this command writes, and HEAD is main. main is protected and takes changes only through a PR. Branch FIRST — the working tree comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>. Writing to the scratchpad or /tmp is allowed on any branch."}}'

exit 0
