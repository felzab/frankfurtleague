#!/usr/bin/env bash
# PreToolUse hook on Bash and PowerShell — refuses a write while HEAD is `main`, on the route
# guard-branch.sh cannot see: a redirect, `sed -i`, a heredoc or an inline interpreter. It refuses
# when it cannot tell; `git checkout -b` matches no write shape.

deny() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this command writes, and HEAD is main. main is protected and takes changes only through a PR. Branch FIRST — the working tree comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>. Allowed on any branch: ONE simple command, running a program that writes only where its arguments say, whose every path-like token lands outside the working tree or on a gitignored untracked path inside it. A chain, a newline, a group or a brace, a substitution, a cd, a deletion, a credential-shaped name, an interpreter or a formatter, or any path git cannot place puts it back here — for a multi-line file use the Write tool, which is allowed both outside the tree and on a gitignored untracked path inside it, such as docs/audit/."}}'
  exit 0
}

# Asked before the payload is read, so a session on a branch pays one git call and nothing more.
# git MISSING is not an answer; being outside a repository is one, and there no main exists to guard.
repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || command -v git >/dev/null 2>&1 || deny
[ -n "$repo_root" ] || exit 0

# A detached HEAD prints nothing and succeeds, which is a real answer rather than a missing one: no
# branch is checked out, so main is not, and denying would break every write during a rebase.
branch="$(git branch --show-current 2>/dev/null)"
[ "$branch" = "main" ] || exit 0

# A hook running at the harness timeout is killed, and a killed hook reads as PERMISSION: a command
# this guard cannot decide in time is a write on main nobody saw. The decision runs in a child on a
# smaller budget, and anything but its answer denies.
if [ "${1:-}" != "--decide" ] && command -v timeout >/dev/null 2>&1; then
  # 15s, under this hook's 30s in `.claude/settings.json`. A budget at or above the harness's lets
  # the harness kill the hook first, which reads as PERMISSION rather than denial.

  # Never lowered towards the decision's own cost: the child reached 14.9s at full core occupancy on
  # 2026-09-02 (n=60, median 7.5s), and a budget near that denies a legitimate write — a refusal
  # nobody can explain is a refusal routed around.

  # Reached on main alone, and stdin is untouched, so the child reads the payload this one has not.
  answer="$(timeout -s KILL 15 bash "$0" --decide)"
  status=$?
  [ "$status" -eq 0 ] || deny
  printf '%s' "$answer"
  exit 0
fi
# With timeout absent there is no watchdog: refusing every command instead would leave the session
# unable to branch away from main at all.

cmd="$(node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let p;
  try {
    p = JSON.parse(s);
  } catch {
    process.exit(1);
  }
  if (p === null || typeof p !== "object") process.exit(1);
  const c = p.tool_input ? p.tool_input.command : undefined;
  if (typeof c !== "string") process.exit(1);
  process.stdout.write(c);
});
' 2>/dev/null)"
read_status=$?

# A payload node could not read is a question nobody answered, so it refuses — the same status node
# absent or crashed leaves. An empty command is a real answer: there is nothing to guard.
[ "$read_status" -eq 0 ] || deny
[ -n "$cmd" ] || exit 0

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

# A write no shape above describes is invisible — `pnpm format`, a program reading its target out of
# a file. What this hook enforces is the shapes it knows.

# The interpreter shape stays out of the shared block: here it would refuse every `python` on `main`.
[ "$writes" = "1" ] || exit 0

# Stated positively: the hook cannot know which token gets written, so every path-like token must
# pass and one must be genuinely exempt. Asking what is tracked releases every path git cannot place.

# No apostrophe anywhere below: this node source is single-quoted, and one would close it.
candidates="$(printf '%s' "$scan" | REPO_ROOT="$repo_root" node -e '
const fs = require("fs");
const path = require("path");

// Spelled as escapes so the surrounding single-quoting survives shellcheck and the shell alike:
// nothing here is meant to expand.
const ESCAPED = /\\[\x22\x27\x60]/g;
const QUOTES = /[\x22\x27\x60]/g;

const WIN = process.platform === "win32";
const unc = (p) => p.replace(/^[\\/]{2}[?.][\\/]/, "");
const msys = (p) => (/^\/[A-Za-z]\//.test(p) ? p.charAt(1) + ":/" + p.slice(3) : p);
const fold = (p) => (WIN ? p.toLowerCase() : p);
// A backslash separates on Windows and is an ordinary filename character everywhere else, so the
// same token has to answer differently per platform — CI is Linux and the dev machine is not.
const sep = (t) => (WIN ? /[\\/]/.test(t) : t.indexOf("/") >= 0);

const exists = (p) => {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
};

// A short alphanumeric extension makes a name a file whether or not one exists there yet, which
// is how a token naming a file the repository lacks still reads as a path.
const extended = (t) => {
  const base = path.basename(WIN ? t.split(/[\\/]/).join("/") : t);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return false;
  const tail = base.slice(dot + 1);
  return tail.length <= 8 && tail.replace(/[^A-Za-z0-9]/g, "").length === tail.length;
};

// Programs whose every operand is a path, so a bare word among them is a target; then those
// mixing paths with literals, where only a path-shaped token counts.
const PATHS = ["cat", "cp", "ls", "mkdir", "mv", "sort", "tee", "touch", "uniq"];
// ln is absent from both lists: a symlink planted in the ignored tree points the exempt class at
// the tracked one, and neither guard resolves a link before deciding.
const MIXED = ["basename", "cut", "date", "diff", "dirname", "echo", "grep", "head", "nl",
  "printf", "rg", "sed", "seq", "tail", "tr", "wc"];
// git subcommands that write nothing of their own; the rest of git is never exemptible.
const GIT_READS = ["blame", "cat-file", "describe", "diff", "for-each-ref", "log", "ls-files",
  "ls-tree", "rev-parse", "shortlog", "show", "status"];
const DISCARD = ["-f", "--force", "--discard-changes", "--ours", "--theirs"];

const decide = (input) => {
  const root = path.resolve(unc(process.env.REPO_ROOT || "."));
  const cmd = input.trim();
  if (cmd === "") return "refuse";

  // A descriptor duplication is the one place a bare ampersand belongs, so it comes out ahead of
  // the scan the way the shape pass takes it out — 2>&1 is chatter, not a second command.
  const chained = cmd.replace(/[0-9]*>&[0-9-]/g, "");
  // One simple command only: a second can write a tracked file naming none of it, and a cd moves
  // the base paths resolve against. Single characters: a background &, a group and a brace each
  // start one, and the shell expands \x24 where this guard cannot.
  const stoppers = ["&", "|", ";", "(", ")", "{", "}", "\x24", "\n", "\r", "\x60", " cd "];
  if (stoppers.some((m) => chained.indexOf(m) >= 0)) return "refuse";

  // No deletion: the tool route can remove nothing, so granting removal here would make this hook
  // the wider of the two.
  const padded = " " + cmd + " ";
  if (padded.indexOf(" rm ") >= 0 || padded.indexOf(" rmdir ") >= 0) return "refuse";

  // A quoted path holding a space arrives split, and the part past the space is not ignored on its
  // own, so a write inside the ignored tree is refused — a false refusal rather than a hole.
  const words = cmd
    .split(/[ \t]+/)
    .filter(Boolean)
    // ESCAPED before QUOTES: a backslash left behind turns the path it wraps into a different path.
    .map((w) => w.replace(ESCAPED, "").replace(QUOTES, ""));

  // Ahead of the flag skip below, because a credential name glued into a flag is the same file.
  const CREDS = [".env", ".pem", ".key", ".p12", "id_rsa", "credentials.json", "kubeconfig", "service-account"];
  // certs/ is a whole-segment match on either separator and on the colon: a bare substring would
  // refuse my-certs/notes.md, which holds no credential, and dropping the colon would miss
  // C:certs\a.md, which is drive-relative and names the same directory.
  const CERT_DIR = /(^|[\\/:])certs[\\/]/;
  const lower = words.map((w) => w.toLowerCase());
  if (lower.some((w) => CREDS.some((c) => w.indexOf(c) >= 0) || CERT_DIR.test(w))) return "refuse";

  const prog = path.basename(words[0]);
  const sub = words.length > 1 ? words[1] : "";
  if (prog === "git") {
    if (sub === "switch" || sub === "checkout") {
      // Changing branch writes what the branch says and names no path. The pathspec form names one,
      // and a discard flag throws away the working tree the branch step is meant to carry.
      const bare = words.indexOf("--") < 0 && !DISCARD.some((f) => words.indexOf(f) >= 0);
      return bare ? "branch-op" : "refuse";
    }
    if (GIT_READS.indexOf(sub) < 0) return "refuse";
  } else if (PATHS.indexOf(prog) < 0 && MIXED.indexOf(prog) < 0) {
    // A closed allowlist, never a list of bad verbs: git commit, pnpm format and an interpreter fed
    // a heredoc all write on their own account, and no scan of arguments sees that.
    return "refuse";
  }

  const out = ["check"];
  let pending = false;
  let operands = false;
  for (let i = 1; i < words.length; i += 1) {
    let t = words[i];
    let target = pending;
    pending = false;

    const op = /^(?:[0-9]+|&)?>{1,2}/.exec(t);
    if (op) {
      const rest = t.slice(op[0].length);
      if (rest === "") {
        pending = true;
        continue;
      }
      if (rest.charAt(0) === "&") continue;
      t = rest;
      target = true;
    }
    t = t.replace(/^<+/, "");
    if (t === "") continue;
    if (t === "--") {
      operands = true;
      continue;
    }

    // A redirect target, and anything after the end-of-options marker, is a path however it starts,
    // so the flag skip must reach neither: both spell a file whose name begins with a dash.
    if (!target && !operands && t.charAt(0) === "-") {
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      t = t.slice(eq + 1);
      if (t === "") continue;
    }

    // From the repository ROOT: the payload carries the command and not the working directory of
    // the shell, so a token spelled from a subdirectory names a different file here than there.
    let abs;
    try {
      abs = path.resolve(root, msys(unc(t)));
    } catch {
      return "refuse";
    }
    const rel = path.relative(fold(root), fold(abs));
    if (rel === "") return "refuse";
    if (path.isAbsolute(rel) || rel === ".." || rel.indexOf(".." + path.sep) === 0) {
      out.push("outside");
      continue;
    }

    // A redirect target is a destination whatever it looks like, as is every argument of a program
    // whose arguments are paths: sort --output=x writes the value half of a flag.
    let placed = target || PATHS.indexOf(prog) >= 0;
    if (!placed) placed = exists(abs) || extended(t) || (sep(t) && exists(path.dirname(abs)));
    out.push((placed ? "1 " : "0 ") + path.relative(root, abs).split(path.sep).join("/"));
  }
  return out.join("\n");
};

let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(decide(s)));
' 2>/dev/null)"

LF="
"
verdict="${candidates%%"$LF"*}"

# Leaving `main` is what this hook must never block, and node has already refused the spellings
# that name a path or discard the working tree.
[ "$verdict" = "branch-op" ] && exit 0
[ "$verdict" = "check" ] || deny

# >>> SHARED EXEMPTION — byte-identical in the branch guards; edit both or neither >>>

anchor=0
paths=()
placed=()
while IFS= read -r line; do
  case "$line" in
    outside) anchor=1 ;;
    "0 "* | "1 "*)
      placed+=("${line%% *}")
      paths+=("${line#* }")
      ;;
  esac
done <<<"$candidates"

if [ "${#paths[@]}" -gt 0 ]; then
  # One pathspec carrying every candidate: any output at all means one of them is tracked, and a
  # pathspec git could not parse is a question nobody answered.
  tracked="$(git -C "$repo_root" ls-files -- "${paths[@]}" 2>/dev/null)" || deny
  [ -z "$tracked" ] || deny

  # check-ignore calls a TRACKED path not ignored, so a hit here is CLAUDE.md 2's "writes no tracked
  # file". quotepath off keeps a German filename byte for byte, which is what the match below needs.
  ignored="$(printf '%s\n' "${paths[@]}" |
    git -c core.quotepath=false -C "$repo_root" check-ignore --stdin 2>/dev/null)"
  status=$?
  [ "$status" -le 1 ] || deny

  index=0
  while [ "$index" -lt "${#paths[@]}" ]; do
    case "$LF$ignored$LF" in
      *"$LF${paths[$index]}$LF"*) anchor=1 ;;
      *) [ "${placed[$index]}" = "1" ] && deny ;;
    esac
    index=$((index + 1))
  done
fi

# At least one token had to be genuinely exempt: a command naming nothing git can place is aimed at
# no exempt path, and releasing it would turn "cannot tell" back into a pass.
[ "$anchor" = "1" ] && exit 0

deny

# <<< SHARED EXEMPTION END <<<
