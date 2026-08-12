#!/usr/bin/env bash
#
# PreToolUse hook on PowerShell — refuses a command that is not provably harmless while HEAD is
# `main`.
#
# WHY THIS EXISTS SEPARATELY FROM guard-branch-bash.sh:
#   This harness exposes a PowerShell tool beside Bash, with its own shell and its own command
#   string, and every PreToolUse guard was registered on the Bash matcher alone. Each one resolved,
#   exited 0 by never running, and the write landed — the same failure guard-branch-bash.sh was
#   written to fix, one tool later. The matcher now names both tools, which carries the compose
#   refusal over this route unchanged; the branch refusal needs this file as well, for the reason
#   below.
#
# WHY IT ENUMERATES READS WHERE THE BASH GUARD ENUMERATES WRITES:
#   That guard lists write shapes and lets the rest past, which holds because POSIX writing is a
#   short vocabulary. PowerShell's is not: Set-Content, Add-Content, Out-File, New-Item, Copy-Item,
#   Move-Item, Rename-Item, Remove-Item, Clear-Content, Export-Csv, Tee-Object, a redirect,
#   [IO.File]::WriteAllText and a method on any object all write, and every verb such a list misses
#   is a silent hole. So this one enumerates READS and refuses whatever it does not recognise. A
#   false refusal is one `git checkout -b` from resolved; a hole is not observable at all (ADR-0060).
#
# WHAT IT MUST NOT REFUSE is a write into the gitignored class — docs/audit/ and .vscode/ — which
# CLAUDE.md §1 exempts and which stays available from a shell on `main`. That is ADR-0067's
# exemption, asked here in ADR-0067's own terms: one simple command, a program whose writes its
# arguments fully describe, every path-like token held to git's answer with at least one required to
# clear it, no deletion, and credential shapes refused ahead of all of it.
#
# CONTRACT: prints nothing and exits 0 on any branch but `main`, for a payload another tool owns,
# and on `main` for a command that is provably read-only or provably aimed at the exempt class.
# Otherwise it prints the deny JSON the PreToolUse event understands, which stops the tool call.
#
# WHAT IT DOES WHEN IT CANNOT TELL — it refuses: a payload node could not read, a quote nobody
# closed, a git that could not name the root, a path git could not place.
#
# WHAT IT CANNOT SEE: a program that reads its target out of a file rather than off the command
# line, and a cmdlet an autoloaded profile redefined. The lists below are shapes, not a proof.
#
# TARGET PLATFORM: any (Git Bash on Windows). node rather than jq — jq is not installed here.

deny() {
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: HEAD is main, and this PowerShell command is neither provably read-only nor aimed at a gitignored path. main is protected and takes changes only through a PR. Branch FIRST — the working tree comes with you:  git checkout main && git pull --ff-only origin main && git checkout -b <short-kebab-name>. Allowed here on main: ONE simple command, either reading through a known read-only cmdlet or git subcommand, or writing through Set-Content, Add-Content, Out-File, New-Item, Copy-Item or Move-Item with every path-like token landing outside the working tree or on a gitignored untracked path inside it, such as docs/audit/. Copy-Item and Move-Item have to name a destination, since without one they write the current directory. A pipeline, a script block, a subexpression, a backtick, a call operator, a type accelerator, a deletion, a credential-shaped name, or a variable ANYWHERE including inside double quotes, where PowerShell expands it and this guard cannot, puts it back here. Single-quote a value that carries a dollar sign or a brace. Anything else belongs in Git Bash, or in the Write tool, which is allowed on those same paths."}}'
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

# The command, and whose it is. Another tool's payload exits 3: this hook is registered on the
# PowerShell matcher alone, and judging a Bash command by PowerShell's vocabulary would refuse it.
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
  if (typeof p.tool_name === "string" && p.tool_name.toLowerCase() !== "powershell") process.exit(3);
  const c = p.tool_input ? p.tool_input.command : undefined;
  if (typeof c !== "string") process.exit(1);
  process.stdout.write(c);
});
' 2>/dev/null)"
read_status=$?

# An unreadable payload is a question nobody answered, and on main that refuses. An empty command is
# a real answer and exits: there is nothing to guard.
case "$read_status" in
  0) ;;
  3) exit 0 ;;
  *) deny ;;
esac
[ -n "$cmd" ] || exit 0

# The whole decision in the one process that can parse: node answers `read-only`, `refuse`, or
# `check` plus one line per token — `outside`, or its repo-relative spelling and a placed-ness flag.
candidates="$(printf '%s' "$cmd" | REPO_ROOT="$repo_root" node -e '
const fs = require("fs");
const path = require("path");

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

// Read-only and closed: a verb missing from here costs a refusal a branch resolves, where a verb
// missing from a list of WRITES would cost a write on main that nothing observes.
const READS = ["compare-object", "convertfrom-json", "convertto-json", "format-list",
  "format-table", "get-childitem", "get-command", "get-content", "get-date", "get-filehash",
  "get-help", "get-item", "get-itemproperty", "get-location", "get-member", "get-module",
  "get-process", "get-variable", "group-object", "join-path", "measure-object", "out-host",
  "out-string", "resolve-path", "select-object", "select-string", "sort-object", "split-path",
  "test-path", "where-object", "write-host", "write-output",
  "cat", "dir", "echo", "git", "ls", "pwd"];
// git subcommands that write nothing of their own; the rest of git is never read-only here.
const GIT_READS = ["blame", "cat-file", "describe", "diff", "for-each-ref", "log", "ls-files",
  "ls-tree", "rev-parse", "shortlog", "show", "status"];

// Cmdlets whose writes their arguments fully describe. Every operand of the first list is a path,
// the second takes one path and then content, and the third writes only through a redirect.
const PATHS = ["copy-item", "move-item"];
const FIRST = ["add-content", "new-item", "out-file", "set-content"];
const ECHO = ["echo", "write-output"];
// Remove-Item, Clear-Content and Rename-Item are absent deliberately: the tool route grants writing
// an ignored path and can remove nothing, so granting removal here would make this the wider guard.

// Parameters whose value is content rather than a path, so the token after one is left unresolved.
// Any other parameter name binds a path, which is the guess that refuses when it is wrong.
const LITERAL = ["-value", "-encoding", "-itemtype", "-delimiter", "-separator", "-filter",
  "-pattern", "-inputobject", "-width", "-stream"];

// Copy-Item and Move-Item bind position 0 to -Path and position 1 to -Destination, and a name here
// fills one of them however short: the binder resolves a prefix as brief as -d to a parameter the
// cmdlet declares, ahead of the common -Debug.
const POSITIONS = ["-path", "-literalpath", "-destination"];
// Every SwitchParameter those two cmdlets declare, read off Get-Command rather than recalled. A
// switch takes no value, so what follows it is positional; a name missing here reads as value-taking
// and swallows a token, the direction that refuses.
const SWITCHES = ["-confirm", "-container", "-debug", "-force", "-passthru", "-recurse",
  "-usetransaction", "-verbose", "-whatif"];

// Structure a second command can hide inside: a call operator, a script block, a subexpression, a
// splat, a type accelerator or a static member. A variable is unresolvable, so it joins them.
const HIDDEN = ["&", "{", "}", "(", ")", "@", "[", "]", "\x60", "\x24", "::"];
const READ_BANS = HIDDEN.concat([">", "<"]);
const WRITE_BANS = HIDDEN.concat(["<", ";", "|"]);

// One pass: bare is what sits outside quotes, interp adds the double-quoted interiors PowerShell
// expands and is scanned as structure too, and plain is the token read as a filename.
const lex = (s) => {
  const out = [];
  let bare = "";
  let interp = "";
  let plain = "";
  let open = "";
  let live = false;
  let bad = false;
  const push = () => {
    if (live) out.push({ bare: bare, interp: interp, plain: plain });
    bare = "";
    interp = "";
    plain = "";
    live = false;
  };
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charAt(i);
    if (open !== "") {
      if (c === open) {
        open = "";
        continue;
      }
      plain += c;
      if (open === "\x22") interp += c;
      continue;
    }
    if (c === "\x22" || c === "\x27") {
      open = c;
      live = true;
      continue;
    }
    // A newline separates statements exactly as a semicolon does, and the write track refuses one
    // anyway, so both tracks stop here rather than letting a second line arrive unread.
    if (c === "\n" || c === "\r") {
      bad = true;
      push();
      continue;
    }
    if (c === " " || c === "\t") {
      push();
      continue;
    }
    bare += c;
    interp += c;
    plain += c;
    live = true;
  }
  push();
  return { tokens: out, bad: bad || open !== "" };
};

// Scanned on interp too, not bare alone: PowerShell expands a variable inside double quotes, so the
// guard would judge the pre-expansion literal while the shell writes the post-expansion path.
const banned = (tokens, chars) =>
  tokens.some((t) => chars.some((c) => t.bare.indexOf(c) >= 0 || t.interp.indexOf(c) >= 0));

// Every segment of a pipeline or a statement list answers on its own, the first word of one being
// its program; an empty segment is a question nobody answered.
const readOnly = (tokens) => {
  if (banned(tokens, READ_BANS)) return false;
  // --output makes a writer of a reader, and the bash guard already counts it a write shape. Read
  // off plain, so a quoted spelling cannot drop out of the structure the words below come from.
  if (tokens.some((t) => t.plain.toLowerCase().indexOf("--output") === 0)) return false;
  return tokens
    .map((t) => t.bare)
    .join(" ")
    .split(/[|;]/)
    .every((part) => {
      const words = part.split(/\s+/).filter(Boolean);
      if (words.length === 0) return false;
      const prog = words[0].toLowerCase();
      if (prog === "git") return words.length > 1 && GIT_READS.indexOf(words[1].toLowerCase()) >= 0;
      return READS.indexOf(prog) >= 0;
    });
};

const exempt = (tokens, root) => {
  if (banned(tokens, WRITE_BANS)) return "refuse";
  const prog = path.basename(tokens[0].plain).toLowerCase();
  if (PATHS.indexOf(prog) < 0 && FIRST.indexOf(prog) < 0 && ECHO.indexOf(prog) < 0) return "refuse";

  // New-Item builds a link as readily as a file, and its -Value is then the link TARGET. The type
  // binds as -i, as -Type or abbreviated, so the value is resolved rather than the type inspected.
  const literals = prog === "new-item" ? LITERAL.filter((n) => n !== "-value") : LITERAL;

  const out = ["check"];
  const paths = PATHS.indexOf(prog) >= 0;
  let pend = false;
  let param = false;
  let skip = false;
  let operands = 0;
  let bound = 0;
  let join = false;
  let first = FIRST.indexOf(prog) >= 0;
  for (let i = 1; i < tokens.length; i += 1) {
    const b = tokens[i].bare;
    let t = tokens[i].plain;
    // A comma binds one array across the whitespace either way round, so a source spelled a, b or
    // a ,b is one operand naming no destination at all — each was run against a real process, and
    // each overwrote two basenames in the current directory.
    const cont = join || t.charAt(0) === ",";
    join = t.slice(-1) === ",";
    // A content parameter releases its value, but only a value: a dash where one was expected names
    // the next parameter instead, and swallowing it would hide the path that follows.
    if (skip) {
      skip = false;
      if (b.charAt(0) !== "-") continue;
    }
    const was = param;
    let target = pend;
    let slot = false;
    pend = false;
    param = false;

    const op = /^(?:[0-9]+|\*)?>{1,2}/.exec(b);
    if (op) {
      t = t.slice(op[0].length);
      if (t === "") {
        pend = true;
        continue;
      }
      target = true;
    } else if (!target && b.charAt(0) === "-") {
      // -Path:value and -Path=value carry the value inside the parameter token, so a path spelled
      // that way is reached here rather than on the next token.
      const eq = t.search(/[:=]/);
      const name = (eq < 0 ? t : t.slice(0, eq)).toLowerCase();
      if (literals.indexOf(name) >= 0) {
        if (eq < 0) skip = true;
        continue;
      }
      // Only these two cmdlets have a positional model to read, and elsewhere a switch reading as
      // value-taking is what makes the token behind it a target — the stricter of the two answers.
      if (paths && name.length > 1 && POSITIONS.some((n) => n.indexOf(name) === 0)) bound += 1;
      if (paths && SWITCHES.indexOf(name) >= 0) continue;
      if (eq < 0) {
        param = true;
        continue;
      }
      t = t.slice(eq + 1);
      if (t === "") continue;
      target = true;
    } else if (!target) {
      slot = !was;
      target = was || paths || first;
      first = false;
    }

    // A comma binds an array of destinations into one token, so the parts are judged apart: holding
    // only the first to the test would release every path spelled after it.
    const before = out.length;
    const parts = t.split(",");
    for (let k = 0; k < parts.length; k += 1) {
      const part = parts[k];
      if (part === "") continue;
      let abs;
      try {
        abs = path.resolve(root, msys(unc(part)));
      } catch {
        return "refuse";
      }
      const rel = path.relative(fold(root), fold(abs));
      if (rel === "") return "refuse";
      if (path.isAbsolute(rel) || rel === ".." || rel.indexOf(".." + path.sep) === 0) {
        out.push("outside");
        continue;
      }
      // A destination is a path whatever it looks like; every other token has to look like one
      // before its verdict counts, which is what keeps a literal argument from deciding anything.
      let placed = target;
      if (!placed) placed = exists(abs) || extended(part) || (sep(part) && exists(path.dirname(abs)));
      out.push((placed ? "1 " : "0 ") + path.relative(root, abs).split(path.sep).join("/"));
    }
    if (out.length > before && !cont) {
      operands += 1;
      if (slot) bound += 1;
    }
  }

  // Copy-Item and Move-Item fall back to the CURRENT directory when nothing binds -Destination, so a
  // source in the exempt tree overwrites its own basename at the root, by a path nothing here names.
  // Both positions must be bound, by name or by an operand.
  if (paths && (operands < 2 || bound < 2)) return "refuse";
  return out.join("\n");
};

// Ahead of both tracks, because a credential file is gitignored by design and would otherwise be
// the one class the exemption releases — guard-branch.sh refuses these for the same reason.
const CREDS = [".env", ".pem", ".key", ".p12", "id_rsa", "credentials.json", "kubeconfig", "service-account"];
// certs/ is a whole-segment match on either separator and on the colon: a bare substring would
// refuse my-certs/notes.md, which holds no credential, and dropping the colon would miss
// C:certs\a.md, which is drive-relative and names the same directory.
const CERT_DIR = /(^|[\\/:])certs[\\/]/;

const decide = (input) => {
  const root = path.resolve(unc(process.env.REPO_ROOT || "."));
  const lexed = lex(input.trim());
  if (lexed.bad || lexed.tokens.length === 0) return "refuse";
  // Both views of a token, because one quoted in pieces spells a name in bare that plain never
  // shows: .e"x"nv reads as .env to the shell and as .exnv to anything reading the literal.
  const views = [];
  lexed.tokens.forEach((t) => views.push(t.plain.toLowerCase(), t.bare.toLowerCase()));
  if (views.some((w) => CREDS.some((c) => w.indexOf(c) >= 0) || CERT_DIR.test(w))) return "refuse";
  if (readOnly(lexed.tokens)) return "read-only";
  return exempt(lexed.tokens, root);
};

let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => process.stdout.write(decide(s)));
' 2>/dev/null)"

LF="
"
verdict="${candidates%%"$LF"*}"

[ "$verdict" = "read-only" ] && exit 0
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
