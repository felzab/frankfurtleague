#!/usr/bin/env bash
#
# PreToolUse hook on Bash — a shell command that WRITES into docs/_standard/ asks the owner first,
# on every branch.
#
# WHY THIS EXISTS SEPARATELY FROM guard-standard-edit.sh AND guard-branch-bash.sh:
#   guard-standard-edit.sh puts the owner's question on screen when Edit, Write or NotebookEdit
#   targets the standard — but it never sees a shell redirect, `sed -i`, a heredoc or an inline
#   `python -c` write, which are the same edit by another route. guard-branch-bash.sh does see
#   those, and stands down the moment HEAD leaves `main` — so on a topic branch the standard was
#   writable from the shell with no question asked. This hook closes that gap: the same shell-write
#   detection, on every branch, answering "ask" rather than "deny" because the owner's rule
#   (2026-08-08) is sign-off, not prohibition.
#
# CONTRACT: prints nothing and exits 0 for a command that does not write, or whose writes cannot
# name a path inside docs/_standard/. For a write shape naming one — or a payload whose command
# cannot be read at all — it prints the "ask" JSON the PreToolUse event understands, which
# surfaces the owner's permission prompt instead of running the command. Fail-closed for
# guard-standard-edit.sh's reason: a hole in the guard costs more than one extra question, and
# the unreadable cases are rare.
#
# TWO DELIBERATE DIFFERENCES FROM guard-branch-bash.sh, whose write/read distinction is otherwise
# copied verbatim so the two guards never disagree about what counts as a write:
#   - No scratchpad or /tmp exemption, and no `checkout -b` escape hatch. Both exist there to let
#     work land outside the tree while `main` is protected; here the question is whether a write
#     can touch the standard, and a command MENTIONING an exempt path can still write into it
#     (`cp <scratchpad>/x docs/_standard/y`), so a mention must not silence the question.
#   - Containment is decided on CANONICAL paths, for guard-branch.sh's reasons: `./` segments,
#     `..` re-entry, doubled separators, `//?/` device prefixes and case-only respellings all name
#     a file inside the standard while sharing no useful prefix with the literal folder path.
#     Relative candidates are resolved from the repository root — the payload does not carry the
#     shell's own working directory, so a relative path spelled from anywhere else is out of
#     reach, which is a narrower miss than any string-prefix alternative.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

ask() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This shell command writes into docs/_standard — the documentation standard changes only with your explicit sign-off (owner rule, 2026-08-08). Approve to let this one command through, or deny and discuss the change first."}}'
  exit 0
}

# No repository here means the command cannot write into docs/_standard of this one.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || exit 0

# The command string, out of the tool payload. Unlike guard-branch-bash.sh — which stays silent on
# a payload it cannot read, because past this point it only ever DENIES — an unreadable payload
# here asks: nothing else downstream can answer for it.
cmd="$(node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let c;
  try {
    c = JSON.parse(s).tool_input?.command;
  } catch {
    process.exit(1);
  }
  if (typeof c !== "string") process.exit(1);
  process.stdout.write(c);
});
' 2>/dev/null)" || ask

# Write shapes, copied from guard-branch-bash.sh — see the header for why the copy is deliberate.
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

# Does any path-like candidate in the command land inside docs/_standard once canonicalised?
# The `$1` is a node replacement pattern and the quote characters are spelled by code (\x22 \x27
# \x60) precisely so the shell single-quoting around this script survives — nothing is meant to
# expand.
# shellcheck disable=SC2016
decision="$(printf '%s' "$cmd" | REPO_ROOT="$repo_root" node -e '
const path = require("path");

let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  // Windows long-path and UNC-device spellings of an ordinary drive path, as in guard-branch.sh.
  const strip = (p) => p.replace(/^[\\/]{2}[?.][\\/]/, "");
  // The MSYS spelling of a drive-absolute path (/c/Users/…) — this hook guards Git Bash, where
  // that form names the same file node spells C:/Users/….
  const msys = (p) => p.replace(/^\/([A-Za-z])\//, "$1:/");
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

  const standard = path.resolve(strip(process.env.REPO_ROOT), "docs", "_standard");

  // Whitespace, quotes and shell metacharacters all end a candidate, so a path buried in inline
  // python code, an --option=value pair or a spaceless redirect still surfaces on its own.
  // Over-splitting is safe: a fragment that is not a path resolves to somewhere that is not the
  // standard.
  const tokens = s.split(/[\s\x22\x27\x60;|&<>(),=]+/).filter(Boolean);

  // Per candidate, the containment answer from guard-standard-edit.sh: empty means the candidate
  // IS the folder, absolute means another drive, and a result that does not climb out means inside.
  const inside = tokens.some((t) => {
    const target = path.resolve(strip(process.env.REPO_ROOT), msys(strip(t)));
    const rel = path.relative(fold(standard), fold(target));
    if (rel === "") return true;
    if (path.isAbsolute(rel)) return false;
    return rel !== ".." && !rel.startsWith(".." + path.sep);
  });

  process.stdout.write(inside ? "ask" : "allow");
});
' 2>/dev/null)"

# Anything but an explicit "allow" asks — which covers node being absent and node crashing.
[ "$decision" = "allow" ] || ask

exit 0
