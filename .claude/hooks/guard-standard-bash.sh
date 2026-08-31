#!/usr/bin/env bash
# PreToolUse hook on Bash and PowerShell — a shell command writing to docs/standard.md asks the
# owner first, on every branch: guard-standard-edit.sh sees only the tools, and guard-branch-bash.sh
# stands down off `main`. It asks whenever it cannot tell, a hole costing more than a question.

ask() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This shell command writes to docs/standard.md — the documentation standard changes only with your explicit sign-off (owner rule, 2026-08-08). Approve to let this one command through, or deny and discuss the change first."}}'
  exit 0
}

# The command string, out of the tool payload. An unreadable payload asks rather than exits, because
# nothing downstream can answer a question this one could not.
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

# The null device is not a destination, so it comes out before the scan rather than being carved out
# after one: a command can send its chatter there while writing somewhere real.
scan="$(printf '%s' "$cmd" | sed -E 's#[0-9&]*>[>&]?[[:space:]]*/dev/null##g')"
# A sed that failed must not read as a command with nothing left in it.
[ -n "$scan" ] || scan="$cmd"

# Blanks collapse first, because the patterns below are spelled with single spaces and extra
# whitespace between a verb and its argument is the same command.
squeezed="$(printf '%s' "$scan" | tr -s ' \t' ' ')"
[ -n "$squeezed" ] || squeezed="$scan"

# Space-prefixed so a verb at the very start is caught: the `rm` pattern has to be " rm " to avoid
# matching inside a word, and `rm docs/x` carries no leading space of its own.
padded=" $squeezed"
writes=0
case "$padded" in
  *" tee "* | *"|tee "*)           writes=1 ;;
  *"--output "* | *"--output="*)   writes=1 ;;
  *" mv "* | *" cp "* | *" ln "* | *" rm "* | *" rmdir "* | *" mkdir "* | *" touch "*) writes=1 ;;
esac

# An inline interpreter names its target in source, where no verb and no redirect shows it. `open(`
# counts whatever the mode says: a false refusal is cheaper than a hole nothing observes.
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

# Global options sit between program and subcommand (`git -c user.name=x commit`), so the subcommand
# is reached by stepping over them. extglob is on for that one expansion alone.
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

# Every redirect spelling, once a descriptor duplication is out of the way: `>&1`, `>&2` and `>&-`
# name no file, while `>&f`, `->f` and `=>f` all redirect INTO f because `>` ends the word before it.
arrows="$(printf '%s' "$padded" | sed -E 's/[0-9]*>&[0-9-]//g')"
[ -n "$arrows" ] || arrows="$padded"
case "$arrows" in
  *">"*) writes=1 ;;
esac

# <<< SHARED WRITE SHAPES END <<<

# An interpreter writes wherever its program says, which no command string shows: `python x.py` names
# nothing here. Asking is cheap where refusing is not, so it counts as a write here and not there.
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

# ANY path-like candidate resolving to docs/standard.md asks: there is no exemption, a token
# landing somewhere harmless answering nothing about the one that does.
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

  const standard = path.resolve(strip(process.env.REPO_ROOT), "docs", "standard.md");

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

  // Per candidate, the equality answer from guard-standard-edit.sh: the standard is one file,
  // so a candidate is inside it only by BEING it — folded, Windows paths being case-blind.
  const inside = tokens.some((t) => {
    const target = path.resolve(strip(process.env.REPO_ROOT), msys(strip(t)));
    return fold(target) === fold(standard);
  });

  process.stdout.write(inside ? "ask" : "allow");
});
' 2>/dev/null)"

# Anything but an explicit "allow" asks — which covers node being absent and node crashing.
[ "$decision" = "allow" ] || ask

exit 0
