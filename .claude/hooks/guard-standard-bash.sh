#!/usr/bin/env bash
# PreToolUse hook on Bash and PowerShell — a shell command writing to docs/_standard/standard.md asks the
# owner first, on every branch: guard-standard-edit.sh sees only the tools, and guard-branch-bash.sh
# stands down off `main`. It asks whenever it cannot tell, a hole costing more than a question.

ask() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"This shell command writes to docs/_standard/standard.md — the documentation standard changes only with your explicit sign-off (owner rule, 2026-08-08). Approve to let this one command through, or deny and discuss the change first."}}'
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

# Space-prefixed so a token at the very start is bounded the way one mid-string is. The source scan
# below reads this, and so does the arrows test, which needs `2>&1` whole.
padded=" $squeezed"

# What every word-bounded pattern reads instead: a separator bounds a word, so `x;rm -rf src`
# carries a verb no " rm " reaches; a quote hides one, and the dollar of ANSI-C `$'rm'` with it.
stripped="$(printf '%s' "$squeezed" |
  sed -E $'s/[$]?\\\\?[\x22\x27\x60]//g' | tr ';&|(){}\n\r' '         ' | tr -s ' ')"
# A pipeline that failed must not read as a command with no verb left in it.
[ -n "$stripped" ] || stripped="$squeezed"

# A backslash escapes — `\rm` and `r\m` both run rm — and separates a Windows path, and no one
# reading answers both, so the scan carries the string twice. Octal below: a lone backslash draws
# a warning from tr and from shellcheck alike.
unescaped="$(printf '%s' "$stripped" | tr -d '\134')"
[ -n "$unescaped" ] || unescaped="$stripped"
separated="$(printf '%s' "$stripped" | tr '\134' '/')"
[ -n "$separated" ] || separated="$stripped"
# Padded at BOTH ends and joined by a space, so a verb at either end of either reading is bounded.
verbs=" $unescaped $separated "
writes=0
# Bounded by a path separator as well as by a space, because `/bin/rm` and `C:\bin\rm.exe` name the
# program a bare `rm` names — the bound the in-place and `-o` arms below already carry.
if [[ "$verbs" =~ [[:space:]/](tee|mv|cp|ln|rm|rmdir|mkdir|touch)(\.exe)?[[:space:]] ]]; then writes=1; fi
case "$verbs" in
  *"--output "* | *"--output="*)   writes=1 ;;
esac

# ANSI-C quoting spells a verb in escapes nothing here decodes — `$'\x72\x6d'` is rm — so a command
# carrying that shape is one this scan could not read, never one it cleared.
case "$padded" in
  *\$\'*\\*) writes=1 ;;
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
if [[ "$verbs" =~ [[:space:]/](sed|perl|ruby|awk|gawk|yq)[0-9.]*(\.exe)?[[:space:]] ]]; then
  # A lowercase cluster only, so `-MList::Util` stays a module and `-Ilib` an include path.
  if [[ "$verbs" =~ [[:space:]]-[[:lower:][:digit:]]*i ]]; then writes=1; fi
  # The spellings carrying no letter cluster: gawk names an extension, yq drops the hyphen.
  case "$verbs" in
    *" --in-place"* | *"inplace"*) writes=1 ;;
  esac
fi

# `-o` selects matches for grep and names a destination for `docker compose config`, sort, curl and
# wget, so it is a write only behind one of those — and behind the compose spelling matched whole.
if [[ "$verbs" =~ [[:space:]/](docker[[:space:]]compose|docker-compose|sort|curl|wget)[0-9.]*(\.exe)?[[:space:]] ]]; then
  case "$verbs" in
    *" -o "* | *" -o="* | *" --lock-image-digests"*) writes=1 ;;
  esac
fi

# Global options sit between program and subcommand, so the stepper skips them, and every `git` is
# walked because a leading read otherwise shadows a chained write. `;git commit` fronts a git as
# plainly as a space does.
read -ra gitwords <<<"$verbs"
# Word by word: `${v#*git }` rescans from every position, and a command of a few kilobytes then
# costs longer than the harness gives a hook — where not answering is read as permission.
total="${#gitwords[@]}"
step=0
while [ "$step" -lt "$total" ]; do
  # A directory in front and a Windows tail behind leave the program the same program.
  word="${gitwords[$step]##*[/\\]}"
  word="${word%.exe}"
  step=$((step + 1))
  [ "$word" = "git" ] || continue
  while [ "$step" -lt "$total" ]; do
    case "${gitwords[$step]}" in
      # Each of these carries its value in the NEXT word, so the pair comes off together.
      -c | -C | --git-dir | --work-tree | --exec-path | --namespace) step=$((step + 2)) ;;
      -*) step=$((step + 1)) ;;
      *) break ;;
    esac
  done
  [ "$step" -lt "$total" ] || break
  case "${gitwords[$step]}" in
    am | apply | cherry-pick | clean | commit | merge | rebase | reset | restore | revert | stash | switch) writes=1 ;;
    # `git checkout -b` is how a session leaves `main` and must never be refused; the pathspec form
    # writes a tracked file and is the spelling that has to be.
    checkout) case "$verbs" in *" -- "*) writes=1 ;; esac ;;
  esac
done

# A quoted `>` redirects nothing, and refusing on one refuses `grep 'a -> b'`. These are the
# programs whose arguments are operands, never an interpreter running what it is handed.
OPERANDS=" basename cat cp cut date diff dirname echo git grep head ls mkdir mv nl printf rg sed seq sort tail tee touch tr uniq wc "
lead="${stripped# }"
lead="${lead%% *}"
lead="${lead##*[/\\]}"
lead="${lead%.exe}"
oneline="${padded//$'\n'/;}"
oneline="${oneline//$'\r'/;}"
# The spans come off only where nothing can hide in them: one simple command, no separator and no
# substitution. ONE left-to-right pass, so a quote of one kind opened inside the other cannot pair
# across a real redirect and carry it away.
quotes=""
case "$oneline" in
  *";"* | *"|"* | *"&"* | *"("* | *")"* | *"{"* | *"}"* | *'$'* | *'`'*) ;;
  *) case "$OPERANDS" in *" $lead "*) quotes=$'s/[\x22][^\x22]*[\x22]|[\x27][^\x27]*[\x27]//g;' ;; esac ;;
esac

# Every redirect spelling, once a descriptor duplication is out of the way: `>&1`, `>&2` and `>&-`
# name no file, while `>&f`, `->f` and `=>f` all redirect INTO f because `>` ends the word before it.
arrows="$(printf '%s' "$padded" | sed -E "$quotes"'s/[0-9]*>&[0-9-]//g')"
[ -n "$arrows" ] || arrows="$padded"
case "$arrows" in
  *">"*) writes=1 ;;
esac

# <<< SHARED WRITE SHAPES END <<<

# An interpreter writes wherever its program says, which no command string shows: `python x.py` names
# nothing here. Asking is cheap where refusing is not, so it counts as a write here and not there.
interpreter=0
# One pattern, not a list: every name carries the same optional Windows tail. Read off the string
# the verb arms read, and bounded as they are, because `\node` and `/usr/bin/node` start what a
# bare `node` starts.
interp_names='python3?|node|bash|sh|perl|ruby|deno|bun|uvx?|npx|pnpm|npm|yarn|make|xargs|env'
if [[ "$verbs" =~ [[:space:]/]($interp_names)(\.exe|\.cmd|\.bat)?[[:space:]] ]]; then interpreter=1; fi

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

# ANY path-like candidate resolving to docs/_standard/standard.md asks: there is no exemption, a token
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

  const standard = path.resolve(strip(process.env.REPO_ROOT), "docs", "_standard", "standard.md");

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
