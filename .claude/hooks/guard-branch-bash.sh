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
# THE EXEMPTION IS STATED POSITIVELY, BECAUSE THE INVERSE QUESTION IS NOT SAFE:
#   guard-branch.sh is handed one path, and allows it when it lies outside the working tree, or
#   inside it and git reports it ignored AND untracked. This hook is handed a command and cannot
#   know which token will be written, so it holds EVERY path-like token to that same test and
#   requires at least one to pass it — the command has to be aimed at the exempt class rather than
#   merely compatible with it. Asking instead whether anything TRACKED is named would release every
#   path git cannot place: a file that does not exist yet, a case-varied spelling, a path hidden
#   inside a `--flag=value`. Each of those refuses here, which is what stops this route being wider
#   than the tool route it mirrors (ADR-0060).
#
# THE TOKEN PASS IS GATED BY THE CONDITIONS BELOW, each of them because a command that satisfies it
# writes a path it never names:
#   - one simple command: no `&&`, `||`, `;`, `|`, newline, `$(`, backtick or ` cd `, because a
#     second command can write a tracked file while naming none of it (`pnpm format` is the case),
#     and a `cd` moves the base every path below is resolved against;
#   - a program whose writes are fully described by its arguments. That is a closed allowlist rather
#     than a list of bad verbs: `git commit`, `pnpm format` and `python - <<EOF` write on their own
#     account, an unknown program might, and no scan of arguments can see either;
#   - no deletion. guard-branch.sh grants writing an ignored path and cannot remove anything, so
#     granting removal here would make this hook the wider of the two.
#   Credential shapes are refused ahead of all of them, whatever `.gitignore` says, exactly as
#   guard-branch.sh refuses them.
#
#   A relative token resolves from the repository ROOT, because the payload carries the command and
#   not the shell's own working directory. One spelled from a subdirectory therefore names a
#   different file here than it does there — the same miss guard-standard-bash.sh records.
#
# WHAT IT DOES WHEN IT CANNOT TELL — it refuses, which is ADR-0060's posture: a payload node could
# not read, a git that could not name the root, a pathspec git could not parse, and above all a path
# git could not place. `git checkout -b` reaches none of that, because it matches no write shape, so
# leaving `main` stays possible for as long as node runs at all — and node not running is the same
# condition that stops the session holding this hook.
#
# WHAT IT CANNOT SEE: a write no write shape describes. `pnpm format`, `sort -o f` and any program
# reading its target out of a file rather than off the command line are invisible here, and the
# allowlist below never gets asked about them. What this hook enforces is the shapes it knows.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

deny() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this command writes, and HEAD is main. main is protected and takes changes only through a PR. Branch FIRST — the working tree comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>. Allowed on any branch: ONE simple command, running a program that writes only where its arguments say, whose every path-like token lands outside the working tree or on a gitignored untracked path inside it. A chain, a newline, a substitution, a cd, a deletion, a credential-shaped name, an interpreter or a formatter, or any path git cannot place puts it back here — for a multi-line file use the Write tool, which is allowed both outside the tree and on a gitignored untracked path inside it, such as docs/audit/."}}'
  exit 0
}

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
read_status=$?

# node absent or crashed answers nothing, and ADR-0060's posture is to refuse a question nobody
# answered rather than to fall silent over every shell write at once. An empty command is a real
# answer and exits: there is no command to guard.
[ "$read_status" -eq 0 ] || deny
[ -n "$cmd" ] || exit 0

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
  *"write_bytes"* | *"write_text"* | *".writelines"*) writes=1 ;;
  *"--output "* | *"--output="*)   writes=1 ;;
  *" mv "* | *" cp "* | *" ln "* | *" rm "* | *" rmdir "* | *" mkdir "* | *" touch "*) writes=1 ;;
esac

# `sed -e s/a/b/ -i f` edits in place as surely as `sed -i` does, so the flag is matched wherever it
# sits rather than only where it usually sits.
case "$padded" in
  *" sed "*)
    case "$padded" in
      *" -i"* | *" --in-place"*) writes=1 ;;
    esac
    ;;
esac

# git's global options sit between the program and its subcommand (`git -c user.name=x commit`), so
# the subcommand is reached by stepping over them rather than by matching the string `git commit`.
rest="${padded#*[ /]git }"
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

# Outside the shared block, because the two guards share the vocabulary and not the answer: the other
# one also asks about an interpreter, which here would refuse every `python` run on `main`.
[ "$writes" = "1" ] || exit 0

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)"
[ -n "$repo_root" ] || deny

# The exemption's parsing, in the one process that can parse: node answers `refuse`, `branch-op`, or
# `check` plus one line per token — `outside`, or its repo-relative spelling and a placed-ness flag.
candidates="$(printf '%s' "$scan" | REPO_ROOT="$repo_root" node -e '
const fs = require("fs");
const path = require("path");

// Quotes, the substitution forms and the backslash are spelled as escapes so the surrounding
// single-quoting survives shellcheck and the shell alike: nothing here is meant to expand.
// A backslashed quote goes first: inside a double-quoted string it is how a one-liner writes a
// quote, and leaving the backslash behind turns the path it wraps into a different path.
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

// A name ending in a short alphanumeric extension is a file whether or not one exists there yet,
// which is how a token naming a file the repository does not have yet still reads as a path.
const extended = (t) => {
  const base = path.basename(WIN ? t.split(/[\\/]/).join("/") : t);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return false;
  const tail = base.slice(dot + 1);
  return tail.length <= 8 && tail.replace(/[^A-Za-z0-9]/g, "").length === tail.length;
};

// Programs whose every operand is a path, so a bare word among them is a target rather than a
// literal, and programs mixing paths with literals, where only a path-shaped token counts.
// ln is absent deliberately: a symlink planted inside the ignored tree points the exempt class at
// the tracked one, and neither guard resolves a link before deciding.
const PATHS = ["cat", "cp", "ls", "mkdir", "mv", "sort", "tee", "touch", "uniq"];
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

  const stoppers = ["&&", "||", ";", "|", "\n", "\r", "\x24(", "\x60", " cd "];
  if (stoppers.some((m) => cmd.indexOf(m) >= 0)) return "refuse";

  const padded = " " + cmd + " ";
  if (padded.indexOf(" rm ") >= 0 || padded.indexOf(" rmdir ") >= 0) return "refuse";

  // A quoted path holding a space arrives split at the space, and the part past it is not ignored
  // on its own, so a write aimed inside the ignored tree is refused. A false refusal rather than a
  // hole, which is the side ADR-0060 errs on.
  const words = cmd
    .split(/[ \t]+/)
    .filter(Boolean)
    .map((w) => w.replace(ESCAPED, "").replace(QUOTES, ""));

  // Ahead of the flag skip below, because a credential name glued into a flag is the same file.
  const CREDS = [".env", ".pem", "id_rsa", "credentials.json", "kubeconfig", "service-account"];
  const lower = words.map((w) => w.toLowerCase());
  if (lower.some((w) => CREDS.some((c) => w.indexOf(c) >= 0))) return "refuse";

  const prog = path.basename(words[0]);
  const sub = words.length > 1 ? words[1] : "";
  if (prog === "git") {
    if (sub === "switch" || sub === "checkout") {
      // Changing branch writes what the branch says and names no path. The pathspec form does name
      // one, and a discard flag throws away the working tree the branch step is meant to carry.
      const bare = words.indexOf("--") < 0 && !DISCARD.some((f) => words.indexOf(f) >= 0);
      return bare ? "branch-op" : "refuse";
    }
    if (GIT_READS.indexOf(sub) < 0) return "refuse";
  } else if (PATHS.indexOf(prog) < 0 && MIXED.indexOf(prog) < 0) {
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
    // so the flag skip must not reach either: both spell a file whose name begins with a dash.
    if (!target && !operands && t.charAt(0) === "-") {
      const eq = t.indexOf("=");
      if (eq < 0) continue;
      t = t.slice(eq + 1);
      if (t === "") continue;
    }

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

    // A redirect target is a destination whatever it looks like, and so is every argument of a
    // program whose arguments are paths: sort --output=x writes the value half of a flag.
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

# Leaving `main` is the action this hook must never block, and node has already refused the
# spellings that name a path or discard the working tree.
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

  # check-ignore echoes back what it calls ignored, and calls a TRACKED path not ignored — a hit here
  # is CLAUDE.md 2's "writes no tracked file". quotepath off keeps a German filename byte for byte,
  # which is what the match below compares.
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
