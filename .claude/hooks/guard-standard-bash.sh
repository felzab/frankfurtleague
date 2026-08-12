#!/usr/bin/env bash
#
# PreToolUse hook on Bash and PowerShell — a shell command that WRITES into docs/_standard/ asks
# the owner first, on every branch.
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
# WHAT THIS GATE CANNOT SEE, STATED HERE SO IT IS NOT MISTAKEN FOR A TOTAL ONE:
#   Both hooks read a command STRING. A program reads its own arguments, its own config and its own
#   source, so `python restamp.py` writes whatever `restamp.py` says and names nothing here. No
#   scan of a command can close that, and making every interpreter invocation ask would put a prompt
#   in front of `python -m pytest`. What is done instead is below: an interpreter counts as a write
#   shape, so an invocation that NAMES a path under the standard asks, and one that hides the path
#   inside a file it reads does not. The gate that sees what a process did rather than what a
#   command said is the commit boundary, not this hook.
#
# DELIBERATE DIFFERENCES FROM guard-branch-bash.sh, whose write/read distinction is otherwise copied
# verbatim so the two guards never disagree about what counts as a write:
#   - An interpreter, and PowerShell's write cmdlets, are write shapes here and not there. The cost
#     of a wrong guess differs: here it is one prompt on a command that already names the standard;
#     there it would refuse every `python scripts/check_docs.py` on `main`, and refuse the
#     gitignored write on `main` that guard-branch-powershell.sh exists to keep granting. Widening a
#     QUESTION is monotonic in a way that widening a REFUSAL is not.
#   - No exemption at all. There, a command is released when every path-like token lands outside the
#     working tree or on a gitignored untracked path inside it, so work can land while `main` is
#     protected. Here the question is whether a write can reach the standard on ANY branch, and a
#     token landing somewhere harmless answers nothing about the one that does
#     (`cp <scratchpad>/x docs/_standard/y`), so no token can silence the question.
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

# The command string, out of the tool payload. An unreadable payload asks rather than exits, for the
# reason ADR-0060 gives: nothing downstream can answer a question this one could not.
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

# Write shapes, copied from guard-branch-bash.sh — the header says why the copy is deliberate.

# >>> SHARED WRITE SHAPES — byte-identical in the two bash guards; edit both or neither >>>

# The null device is not a destination, so a redirect into it is removed before the scan rather than
# carved out after one: a command can send its chatter there while writing somewhere real.
scan="$(printf '%s' "$cmd" | sed -E 's#[0-9&]*>[>&]?[[:space:]]*/dev/null##g')"
# A sed that failed must not read as a command with nothing left in it.
[ -n "$scan" ] || scan="$cmd"

# Runs of blanks collapse before the patterns below, which are spelled with single spaces: extra
# whitespace between a verb and its argument is the same command and must not read as another one.
squeezed="$(printf '%s' "$scan" | tr -s ' \t' ' ')"
[ -n "$squeezed" ] || squeezed="$scan"

# Matched against a SPACE-PREFIXED copy so a verb at the very start of the command is caught: the
# pattern for `rm` has to be " rm " to avoid matching inside a word, and `rm docs/x` has no leading
# space of its own.
padded=" $squeezed"
writes=0
case "$padded" in
  *" tee "* | *"|tee "*)           writes=1 ;;
  *"--output "* | *"--output="*)   writes=1 ;;
  *" mv "* | *" cp "* | *" ln "* | *" rm "* | *" rmdir "* | *" mkdir "* | *" touch "*) writes=1 ;;
esac

# An inline interpreter names its target in source, where no verb and no redirect shows it.
# `open(` counts whatever the mode says, so a read spelled that way refuses too — ADR-0060's
# posture, and cheaper than a hole nothing observes.
case "$padded" in
  *"open("* | *"openSync"* | *".write"* | *"write_text"* | *"write_bytes"* | *"writeFile"*) writes=1 ;;
  *"appendFile"* | *"createWriteStream"* | *".rename"* | *".replace("* | *".remove"*) writes=1 ;;
  *".unlink"* | *".truncate"* | *".chmod"* | *".touch("* | *".mkdir"* | *".makedirs"*) writes=1 ;;
  *".rmdir"* | *".symlink"* | *".link"* | *"hardlink"* | *"shutil."* | *"copyFile"*) writes=1 ;;
  *"rmSync"* | *"cpSync"* | *"ZipFile"*) writes=1 ;;
esac

# The program is gated because `-i` is case-insensitive to grep and interactive to cp, and the flag
# is matched by SHAPE: `-pi`, `-i.bak` and `-nli.orig` edit in place as surely as `-i` does.
if [[ "$padded" =~ [[:space:]/](sed|perl|ruby|awk|gawk|yq)[0-9.]*(\.exe)?[[:space:]] ]]; then
  # A lowercase cluster only, so `-MList::Util` stays a module and `-Ilib` an include path.
  if [[ "$padded" =~ [[:space:]]-[[:lower:][:digit:]]*i ]]; then writes=1; fi
  # The spellings carrying no letter cluster: gawk names an extension, yq drops the hyphen.
  case "$padded" in
    *" --in-place"* | *"inplace"*) writes=1 ;;
  esac
fi

# Global options sit between program and subcommand (`git -c user.name=x commit`), so the
# subcommand is reached by stepping over them. The `.exe` tail is optional as on the in-place arm
# above; extglob is on for that one expansion only.
shopt -s extglob
rest="${padded#*[ /]git?(.exe) }"
shopt -u extglob
if [ "$rest" != "$padded" ]; then
  while :; do
    case "$rest" in
      *" "*) ;;
      *) break ;;
    esac
    case "$rest" in
      "-c "* | "-C "* | "--git-dir "* | "--work-tree "* | "--exec-path "* | "--namespace "*)
        rest="${rest#* }"
        rest="${rest#* }"
        ;;
      -*) rest="${rest#* }" ;;
      *) break ;;
    esac
  done
  case "${rest%% *}" in
    am | apply | cherry-pick | clean | commit | merge | rebase | reset | restore | revert | stash | switch) writes=1 ;;
    # `git checkout -b` is how a session leaves `main` and must never be refused; the pathspec form
    # writes a tracked file and is the spelling that has to be.
    checkout) case "$padded" in *" -- "*) writes=1 ;; esac ;;
  esac
fi

# Every redirect spelling, `>f` and `2>f` included, once a descriptor duplication is out of the way.
# `>&1`, `>&2` and `>&-` name no file; `>&f`, `->f` and `=>f` all redirect INTO f, because `>` ends
# the word before it.
arrows="$(printf '%s' "$padded" | sed -E 's/[0-9]*>&[0-9-]//g')"
[ -n "$arrows" ] || arrows="$padded"
case "$arrows" in
  *">"*) writes=1 ;;
esac

# <<< SHARED WRITE SHAPES END <<<

# An interpreter writes wherever its program says, which no command string shows. Asking is cheap
# where refusing is not, so it counts here alone — its own flag, outside the block the branch guard
# shares.
interpreter=0
# One pattern, not a list: every name carries the same optional Windows tail. python.exe, node.exe
# and pnpm.cmd all resolve here and name what the bare spelling names, as on the in-place arm above.
interp_names='python3?|node|bash|sh|perl|ruby|deno|bun|uvx?|npx|pnpm|npm|yarn|make|xargs|env'
if [[ "$padded" =~ [[:space:]]($interp_names)(\.exe|\.cmd|\.bat)?[[:space:]] ]]; then interpreter=1; fi

# PowerShell's write cmdlets, on the interpreter flag for its reason: the matcher reaches this hook
# on both shells, none of these is POSIX, and asking is cheap. Matched case-blind, which is how
# PowerShell binds a cmdlet name.
shopt -s nocasematch
# A cmdlet name never follows a letter, so demanding a non-letter ahead of it keeps `asset-content`
# from reading as `Set-Content` and stops `Move-Item` swallowing `Remove-Item`.
case "$padded" in
  *[!a-z]"Set-Content"* | *[!a-z]"Add-Content"* | *[!a-z]"Clear-Content"* | \
  *[!a-z]"Out-File"* | *[!a-z]"New-Item"* | *[!a-z]"Copy-Item"* | *[!a-z]"Move-Item"* | \
  *[!a-z]"Rename-Item"* | *[!a-z]"Remove-Item"* | *[!a-z]"Export-Csv"* | \
  *[!a-z]"Tee-Object"* | *[!a-z]"WriteAll"* | *[!a-z]"AppendAll"*) interpreter=1 ;;
esac
shopt -u nocasematch

[ "$writes" = "1" ] || [ "$interpreter" = "1" ] || exit 0

# Asked only of a command that could write, so a missing git costs a question on those rather than
# on every command. Not being in a repository is an answer; git MISSING is not.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || command -v git >/dev/null 2>&1 || ask
[ -n "$repo_root" ] || exit 0

# Does any path-like candidate land inside docs/_standard once canonicalised? The quotes are spelled
# as escapes (\x22 \x27 \x60) so the surrounding single-quoting survives, and nothing can expand.
decision="$(printf '%s' "$scan" | REPO_ROOT="$repo_root" node -e '
const path = require("path");

let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  // Windows long-path and UNC-device spellings of an ordinary drive path, as in guard-branch.sh.
  const strip = (p) => p.replace(/^[\\/]{2}[?.][\\/]/, "");
  // The MSYS spelling of a drive-absolute path (/c/Users/…) — this hook guards Git Bash, where
  // that form names the same file node spells C:/Users/….
  const msys = (p) => (/^\/[A-Za-z]\//.test(p) ? p.charAt(1) + ":/" + p.slice(3) : p);
  const fold = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

  const standard = path.resolve(strip(process.env.REPO_ROOT), "docs", "_standard");

  // PowerShell binds a value with a colon, which the split below leaves glued to its flag. The
  // leading dash is what keeps a drive letter out: C:/x is a path, not a bound parameter.
  const BOUND = /^-+[A-Za-z][A-Za-z0-9-]*:/;

  // Whitespace and shell metacharacters end a candidate, so a path buried in inline python code, an
  // --option=value pair or a spaceless redirect still surfaces on its own. Quotes are REMOVED, not
  // split on: neither half of a quoted path is a path.
  const tokens = s
    .split(/[\s;|&<>(),=]+/)
    // A backslashed quote goes first: the backslash left behind resolves somewhere else entirely.
    .map((t) => t.replace(/\\[\x22\x27\x60]/g, "").replace(/[\x22\x27\x60]/g, ""))
    // The flag is kept beside its value: only ADDING a candidate can turn an allow into an ask.
    .flatMap((t) => (BOUND.test(t) ? [t, t.replace(BOUND, "")] : [t]))
    .filter(Boolean);

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
