#!/usr/bin/env bash
# PreToolUse hook on Bash — refuses a write while HEAD is `main`, on the route guard-branch.sh
# cannot see: a redirect, `sed -i`, a heredoc or an inline interpreter. It refuses when it cannot
# tell; `git checkout -b` matches no write shape.

deny() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this command writes, and HEAD is main. main is protected and takes changes only through a PR. Branch FIRST — the working tree comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>. Allowed on any branch: ONE simple command, running a program that writes only where its arguments say, whose every path-like token lands outside the working tree or on a gitignored untracked path inside it. A chain, a newline, a substitution, a cd, a deletion, a credential-shaped name, an interpreter or a formatter, or any path git cannot place puts it back here — for a multi-line file use the Write tool, which is allowed both outside the tree and on a gitignored untracked path inside it, such as docs/audit/."}}'
  exit 0
}

branch="$(git branch --show-current 2>/dev/null)"
[ "$branch" = "main" ] || exit 0

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

# Global options sit between program and subcommand, so the stepper skips them. Every `git` is
# walked — a leading read otherwise shadows a chained write — and the class reaches the newline
# and CR `tr` leaves alone. extglob is on for that one expansion.
shopt -s extglob
gitscan="$padded"
while :; do
  rest="${gitscan#*[[:space:]/]git?(.exe) }"
  [ "$rest" = "$gitscan" ] && break
  gitscan="$rest"
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
  # The subcommand word ends at any whitespace: a newline straight after it must not glue the next
  # line's first word onto it.
  case "${rest%%[[:space:]]*}" in
    am | apply | cherry-pick | clean | commit | merge | rebase | reset | restore | revert | stash | switch) writes=1 ;;
    # `git checkout -b` is how a session leaves `main` and must never be refused; the pathspec form
    # writes a tracked file and is the spelling that has to be.
    checkout) case "$padded" in *" -- "*) writes=1 ;; esac ;;
  esac
done
shopt -u extglob

# Every redirect spelling, once a descriptor duplication is out of the way: `>&1`, `>&2` and `>&-`
# name no file, while `>&f`, `->f` and `=>f` all redirect INTO f because `>` ends the word before it.
arrows="$(printf '%s' "$padded" | sed -E 's/[0-9]*>&[0-9-]//g')"
[ -n "$arrows" ] || arrows="$padded"
case "$arrows" in
  *">"*) writes=1 ;;
esac

# <<< SHARED WRITE SHAPES END <<<

# A write no shape above describes is invisible — `pnpm format`, `sort -o f`, a program reading
# its target out of a file. What this hook enforces is the shapes it knows.

# The interpreter shape stays out of the shared block: here it would refuse every `python` on `main`.
[ "$writes" = "1" ] || exit 0

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || deny

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

  // One simple command only: a second can write a tracked file while naming none of it, and a cd
  // moves the base every path below resolves against.
  const stoppers = ["&&", "||", ";", "|", "\n", "\r", "\x24(", "\x60", " cd "];
  if (stoppers.some((m) => cmd.indexOf(m) >= 0)) return "refuse";

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
