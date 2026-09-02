#!/usr/bin/env bash
# PreToolUse hook on Bash and PowerShell — refuses a command that reads, prints, encodes or
# transmits credential material, or that names a path .gitignore matches. CLAUDE.md section 1 is
# absolute, and a permissions.deny entry never reads a command line, so the shell route had no
# mechanical enforcement at all.
#
# It decides on the command TEXT, plus one question to git: the payload carries no output, so
# nothing in it separates a mention from a read. A grep pattern or a heredoc naming .env refuses
# alongside a cat of it — the false refusal is the price of the route staying closed.

deny() {
  # The backticks are Markdown in the refusal copy, not substitution.
  # shellcheck disable=SC2016
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this command names credential material, or a route that renders it. CLAUDE.md section 1 forbids reading, printing, logging, echoing, decoding, summarising, diffing or transmitting `.env*` and every key, certificate, token or service-account file, and forbids the indirect route on the same terms. Refused here: a credential-shaped path, quoted or bare, or a glob reaching one (`.env*`, `*.pem`, `*.key`, `*.crt`, `*.p12`, `*.p8`, `*.gpg`, `id_rsa*`, `credentials.json`, `kubeconfig`, `.npmrc`, or a `certs/`, `secrets/`, `.ssh/`, `.aws/`, `.kube/` or `.local-db/` segment); an expansion of a credential-named variable (`$AUTH_SECRET`, `$env:MONGODB_URI`, `process.env.INTERNAL_API_KEY_BASE`, `$ENV{...}`, `ENVIRON[...]`); a whole-environment dump (`env`, `printenv`, a bare `set`, `Get-ChildItem Env:`, `console.log(process.env)`); a container route onto a loaded environment (`docker inspect`, `docker exec`, `docker compose config`); a token printer (`gh auth token`, `npm token`, `kubectl config view`, `aws configure get`); an encoder (`base64`, `certutil -encode`); a spelling this guard cannot read at all (ANSI-C quoting, an encoded PowerShell command, an indirect expansion, `eval`); and a secret VALUE spelled into the command itself — a private-key header, a URI carrying a password, a provider key prefix. It judges the command text alone, having no output, so it cannot tell a mention from a read and refuses both. To search the corpus for one of these names, use the Grep tool, whose reads the permissions deny list governs, or spell the pattern so that no path matches — `grep -rn env_file docs/`. To learn whether the stack is wired, run `./scripts/local.sh` and read what it reports."}}'
  exit 0
}

deny_ignored() { # $1 the path git reported
  local shown="${1//\\/\\\\}"
  shown="${shown//\"/\\\"}"
  printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"BLOCKED: this command names a path .gitignore matches: '"$shown"'. CLAUDE.md section 1 puts every gitignored path off-limits, apart from dependencies and build output (node_modules, .venv, .next, .claude/worktrees) and the two paths it exempts (docs/audit/, .vscode/). git check-ignore is the oracle, so what refuses is exactly what the ignore files say — a credential file, a database copy, a local settings override, a cache. Read the tracked source instead, or the definition that produces the path."}}'
  exit 0
}

# A hook running at the harness timeout is killed, and a killed hook prints nothing, which reads as
# PERMISSION. The decision runs in a child on a smaller budget, and anything but its answer refuses.
if [ "${1:-}" != "--decide" ] && command -v timeout >/dev/null 2>&1; then
  # stdin is untouched, so the child reads the payload this invocation has not.
  answer="$(timeout -s KILL 6 bash "$0" --decide)"
  status=$?
  [ "$status" -eq 0 ] || deny
  printf '%s' "$answer"
  exit 0
fi
# With timeout absent there is no watchdog: refusing every command instead would leave the session
# unable to run anything, and the scan below is one linear pass over a bounded string.

# No apostrophe below: this node source is single-quoted. Its first line is allow, deny or check;
# behind check stand the absolute paths git is asked about.
# shellcheck disable=SC2016  # every dollar below is node source, never a shell expansion
verdict="$(node -e '
const path = require("path");

// One pass with the quoting the shell applies. A word records whether it stood in quotes: a
// bare server.key is a file, o.key inside a quoted program an expression. A backtick cuts.
const scan = (text) => {
  const segs = [[]];
  let word = "";
  let has = false;
  let quoted = false;
  let q = "";
  const flush = () => {
    if (has && word !== "") segs[segs.length - 1].push({ t: word, q: quoted });
    word = "";
    has = false;
    quoted = false;
  };
  const cut = () => {
    flush();
    if (segs[segs.length - 1].length > 0) segs.push([]);
  };
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charAt(i);
    if (q !== "") {
      if (c === q) q = "";
      else { word += c; has = true; quoted = true; }
      continue;
    }
    if (c === "\x22" || c === "\x27") { q = c; has = true; quoted = true; continue; }
    if (c === "\\") {
      if (i + 1 < text.length) { word += text.charAt(i + 1); has = true; i += 1; }
      continue;
    }
    if (";|&\n\r(){}\x60".indexOf(c) >= 0) { cut(); continue; }
    if (c === " " || c === "\t") { flush(); continue; }
    word += c;
    has = true;
  }
  flush();
  return segs.filter((s) => s.length > 0);
};

const decide = (cmd, cwd) => {
  if (cmd.trim() === "") return "allow";
  // Longer than this was not read inside the budget, so it is not a command this scan cleared.
  if (cmd.length > 65536) return "deny";

  // A secret VALUE spelled into the command itself, wherever it sits, a heredoc body included.
  // This is the one pass that reads the raw string: quoting cannot make a key stop being one.
  const VALUES = [
    /-----BEGIN[A-Z ]*PRIVATE KEY/i,
    // A URI carrying a password. The password class excludes / so that host:port/path is not one.
    // Every repetition is bounded: an unbounded one restarts at each character of a long command
    // and costs seconds, which the watchdog then reads as a refusal.
    /[a-z][a-z0-9+.-]{0,15}:\/\/[^\s\/@:\x22\x27]{1,128}:[^\s\/@\x22\x27]{1,128}@/i,
    /\bghp_[A-Za-z0-9]{16,}/,
    /\bgho_[A-Za-z0-9]{16,}/,
    /\bgithub_pat_[A-Za-z0-9_]{20,}/,
    /\bA(?:KIA|SIA)[0-9A-Z]{16}/,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
    /\bAIza[0-9A-Za-z_-]{35}/,
    /\bsk-[A-Za-z0-9]{20,}/,
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./,
  ];
  if (VALUES.some((r) => r.test(cmd))) return "deny";

  // Spellings this scan cannot read, refused rather than cleared: an ANSI-C numeric or hex escape
  // (a \t or \n spells no letter and stays ordinary), an encoded PowerShell command, an indirect
  // expansion naming its variable at run time.
  const OPAQUE = [/\$\x27[^\x27]*\\(x|u|[0-7])/i,
    /(^|\s)-e(nc|ncodedcommand)?\s+[A-Za-z0-9+\/]{24,}/i, /\$\{!/];
  if (OPAQUE.some((r) => r.test(cmd))) return "deny";

  // Quoting and escaping come off, so a name spelled across them is one word again. A line
  // continuation is one joint and goes first. Two readings, because a backslash both escapes a
  // character and separates a Windows path.
  const joined = cmd.replace(/\\\r?\n/g, "");
  const unquoted = joined.replace(/[\x22\x27\x60]/g, "");
  // The third reading drops the glob punctuation, so fl_backend/[.]env reads as the file it
  // expands to rather than as a name no pattern below matches.
  const flat = [
    unquoted.replace(/\\/g, ""),
    unquoted.replace(/\\/g, "/"),
    unquoted.replace(/[\\*?\[\]]/g, ""),
  ].join("\n").toLowerCase();

  // Names carrying their own boundary, so a substring is safe. .env is the exception: process.env
  // and os.environ end in it, which is why a word character in front disqualifies the match. .key
  // is the other, read below by where it stands rather than here.
  const PATHS = [
    /(^|[^a-z0-9_])\.env(?![a-z])/,
    /\.envrc/,
    /\.pem(?![a-z0-9])/,
    /\.p12(?![a-z0-9])/,
    /\.pfx(?![a-z0-9])/,
    /\.p8(?![a-z0-9])/,
    /\.pk8(?![a-z0-9])/,
    /\.crt(?![a-z0-9])/,
    /\.cer(?![a-z0-9])/,
    /\.asc(?![a-z0-9])/,
    /\.gpg(?![a-z0-9])/,
    /\.ovpn(?![a-z0-9])/,
    /\.jks(?![a-z0-9])/,
    /\.keystore(?![a-z0-9])/,
    /\.kdbx(?![a-z0-9])/,
    /\.ppk(?![a-z0-9])/,
    /\.npmrc/,
    /\.netrc|(^|[^a-z0-9_])_netrc/,
    /\.pgpass/,
    /\.htpasswd/,
    /id_rsa|id_dsa|id_ecdsa|id_ed25519/,
    /credentials\.json/,
    /kubeconfig/,
    /service[-_]?account/,
    /_authtoken/,
    // A whole segment on either reading, so my-certs/notes.md and secretsauce.ts are not matches.
    /(^|[^a-z0-9_.-])certs\//,
    /(^|[^a-z0-9_.-])secrets\//,
    /(^|[^a-z0-9_.-])\.local-db/,
    /(^|[^a-z0-9_.-])\.ssh\//,
    /(^|[^a-z0-9_.-])\.aws\//,
    /(^|[^a-z0-9_.-])\.kube\//,
    /(^|[^a-z0-9_.-])\.gnupg\//,
    /\.docker\/config\.json/,
  ];
  if (PATHS.some((r) => r.test(flat))) return "deny";

  // A credential name as a whole quoted string is a file wherever it sits — the operand of a
  // readFileSync or an open() inside an inline program included.
  const LITERAL = /[\x22\x27][^\x22\x27\r\n]{0,200}\.(key|crt|cer|pem|p8|pfx|p12|pk8|asc|gpg|ovpn|jks|keystore|ppk|kdbx)[\x22\x27]/i;
  if (LITERAL.test(joined)) return "deny";

  // Extensions a bare substring cannot carry: object.key and process.env are expressions, not
  // files. A separator in the token is what makes it a path, so only then does the tail decide.
  const EXT = new Set(["env", "envrc", "key", "crt", "cer", "p8", "asc", "gpg", "jks",
    "keystore", "ppk", "kdbx", "ovpn"]);
  const tail = (w) => {
    const base = w.split(/[\\\/]/).pop().toLowerCase();
    const dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) return "";
    const ext = base.slice(dot + 1);
    return /^[a-z0-9]{1,9}$/.test(ext) ? ext : "";
  };
  // A bracket expression is read by the third flat reading above, so only the wildcards are read
  // here — and a character class in a search pattern stays a search pattern.
  const GLOB = /[*?]/;
  for (const raw of unquoted.split(/[\s;|&<>(){}\[\],=]+/)) {
    if (raw === "") continue;
    const base = raw.split(/[\\\/]/).pop().toLowerCase();
    // A pattern reaches what a name does. One onto a dotfile is how .env is read without being
    // named, and one carrying a credential word is aimed at the same family.
    if (GLOB.test(base)) {
      if (base.charAt(0) === ".") return "deny";
      if (/env|key|pem|cred|secret|token|cert|passw/.test(raw.toLowerCase())) return "deny";
    }
    if (/[\\\/]/.test(raw) && EXT.has(tail(raw))) return "deny";
  }

  // A variable holding credential material, in the spellings both shells and the inline
  // interpreters use. An expansion is a disclosure wherever the result lands, so the value never
  // has to reach the screen.
  const STRONG = /(SECRET|TOKEN|PASSWORD|PASSWD|PASSPHRASE|CRED|APIKEY|API_KEY|ACCESS_KEY|PRIVATE_KEY|SIGNING_KEY|ENCRYPTION_KEY|MONGO|DATABASE_URL|CONNECTION_STRING|PGPASS|(^|_)PASS(_|$))/i;
  // KEY alone is a shell loop variable as often as a secret, so the generic tail is read only on
  // an all-capitals name — the convention separating an exported variable from a local one.
  const credVar = (n) => STRONG.test(n) || (/^[A-Z0-9_]+$/.test(n) && /(^|_)KEYS?$/.test(n));
  // The quote is optional in every bracketed form: the scan below reads the string with quoting
  // already removed, so demanding one would miss os.environ["X"] exactly as it is written.
  const REFS = [
    [/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, 1],
    [/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, 1],
    [/%([A-Za-z_][A-Za-z0-9_]*)%/g, 1],
    [/process\.env\.([A-Za-z_][A-Za-z0-9_]*)/g, 1],
    [/process\.env\[\s*[\x22\x27]?([A-Za-z_][A-Za-z0-9_]*)/g, 1],
    [/os\.environ(?:\.get)?[\[(]\s*[\x22\x27]?([A-Za-z_][A-Za-z0-9_]*)/g, 1],
    [/getenv\(\s*[\x22\x27]?([A-Za-z_][A-Za-z0-9_]*)/g, 1],
    [/GetEnvironmentVariable\(\s*[\x22\x27]?([A-Za-z_][A-Za-z0-9_]*)/gi, 1],
    [/(^|[^$A-Za-z0-9_])Env:([A-Za-z_][A-Za-z0-9_]*)/gi, 2],
    // The brace form PowerShell also accepts, then perl, awk and ruby, each of which reaches the
    // environment by a name none of the spellings above carries.
    [/\$\{env:([A-Za-z_][A-Za-z0-9_]*)/gi, 1],
    [/\$ENV\{\s*[\x22\x27]?([A-Za-z_][A-Za-z0-9_]*)/g, 1],
    [/\bENVIRON\[\s*[\x22\x27]?([A-Za-z_][A-Za-z0-9_]*)/g, 1],
    [/\bENV\[\s*[\x22\x27]?([A-Za-z_][A-Za-z0-9_]*)/g, 1],
    // An indirection through a plain word: n=AUTH_SECRET names the secret without expanding it.
    [/(^|\s)[A-Za-z_][A-Za-z0-9_]*=([A-Za-z_][A-Za-z0-9_]*)(?=[\s;|&)]|$)/g, 2],
  ];
  for (const [rx, group] of REFS) {
    let m;
    while ((m = rx.exec(unquoted)) !== null) {
      if (m[group] && credVar(m[group])) return "deny";
    }
  }

  // The whole environment at once. Read where the expression ENDS, so a name or a closing quote
  // after the dot keeps it a reference rather than a dump.
  const DUMPS = [
    /process\.env\s*(?:[)\],;}]|$)/,
    /os\.environ\s*(?:[)\],;}]|$)/,
    /os\.environ\.(items|keys|values|copy)/,
    /dict\(\s*os\.environ/,
    /GetEnvironmentVariables\s*\(/i,
    // The PowerShell drive with no variable name behind it: Get-ChildItem Env: and ls env:\ .
    /(^|[\s(=,])env:(\s|$|\*|\\|\/)/i,
    // perl, awk and ruby spell the whole environment as one value.
    /%ENV\b/,
    /\bin\s+ENVIRON\b/,
    /\bENV\.(each|to_h|keys|values|to_a)/,
    /\$_(ENV|SERVER)\b/,
  ];

  // Programs whose own behaviour is the disclosure, judged at program position so a mention among
  // the arguments of something else buys neither refusal nor release.
  const PREFIX = new Set(["command", "exec", "ionice", "nice", "nohup", "setsid", "stdbuf",
    "sudo", "time", "timeout"]);
  // A searcher prints what it is pointed at and evaluates none of it, so process.env in its
  // pattern is a string. It buys no exemption from the path passes above, which is where a
  // searcher aimed at a credential file is refused.
  const SEARCH = new Set(["ack", "ag", "egrep", "fgrep", "findstr", "git", "grep", "rg",
    "select-string", "sls"]);
  // A reader takes files as operands, so a bare local.env is a file there with no separator,
  // where inside an inline program the same token is an expression.
  const READERS = new Set([".", "awk", "bat", "cat", "cmp", "code", "column", "cp", "curl",
    "cut", "dd", "diff", "egrep", "expand", "fgrep", "file", "fold", "gc", "get-content", "grep",
    "head", "hexdump", "jq", "less", "ls", "mapfile", "more", "mv", "nano", "nl", "nvim", "od",
    "openssl", "paste", "pr", "readarray", "rev", "rg", "scp", "sed", "select-string", "shuf",
    "sls", "sort", "source", "ssh-add", "ssh-keygen", "stat", "strings", "tac", "tail", "tee",
    "type", "uniq", "vi", "vim", "wc", "wget", "xargs", "xxd"]);
  // A shell handed a command in a flag hides a whole second segment from a scan reading program
  // position, so that flag is followed rather than trusted.
  const SHELLS = new Set(["bash", "busybox", "cmd", "dash", "ksh", "powershell", "pwsh", "sh",
    "zsh"]);
  const stem = (w) => w.split(/[\\\/]/).pop().toLowerCase().replace(/\.(exe|cmd|bat)$/, "");
  const assignment = /^[A-Za-z_][A-Za-z0-9_]*=/;
  // A prefix carries its own flags and, for timeout and nice, a bare duration or priority; the
  // program is what stands past them.
  const carried = (w) => w.charAt(0) === "-" || /^[0-9]+(\.[0-9]+)?[smhd]?$/.test(w);
  // A prefix flag taking its value in the next word: sudo -u root, timeout -s KILL, stdbuf -o L.
  const VALUED = new Set(["-u", "-g", "-h", "-p", "-r", "-t", "-U", "-C", "-T", "-s", "-k",
    "-o", "-e", "-i", "-n", "-c"]);
  const queue = scan(joined);
  // Applied to the whole string as well, because a segment split on a parenthesis never carries
  // the call it opened. A searcher anywhere stands the pass down: its pattern is text, not code.
  const searching = queue.some((w) => SEARCH.has(stem(w[0].t)));
  // The paths git is asked about: every word at shell level that could name a file, read by the
  // shell exactly as written, so a redirect target and the value of if= are words too.
  const candidates = [];
  const seen = new Set();
  for (const seg of queue) {
    for (const w of seg) {
      // Not quoted, or the whole word was: an unquoted word carrying a credential extension is a
      // file the shell hands to whatever runs, whichever program that is.
      const bare = w.t.replace(/^[0-9]*[<>]+&?/, "").split("=").pop();
      if (bare === "" || bare.charAt(0) === "-") continue;
      if (!w.q && EXT.has(tail(bare)) && tail(bare) !== "env" && tail(bare) !== "envrc") return "deny";
      if (bare.indexOf("$") >= 0 || bare.indexOf("://") >= 0 || GLOB.test(bare)) continue;
      if (bare === "." || bare === ".." || bare === "/") continue;
      const pathlike = /[\\\/]/.test(bare) || bare.charAt(0) === "." || tail(bare) !== "";
      if (!pathlike) continue;
      // The MSYS drive spelling names the same file its Windows spelling does.
      const msys = /^\/[A-Za-z]\//.test(bare) ? bare.charAt(1) + ":/" + bare.slice(3) : bare;
      let abs;
      try { abs = path.resolve(cwd, msys.replace(/^[\\\/]{2}[?.][\\\/]/, "")); } catch { continue; }
      abs = abs.split(path.sep).join("/");
      // A trailing slash survives: git reads a directory-only rule against a path that does not
      // exist yet only when the path says it is a directory.
      if (/[\\\/]$/.test(bare) && abs.charAt(abs.length - 1) !== "/") abs += "/";
      if (!seen.has(abs)) { seen.add(abs); candidates.push(abs); }
    }
  }

  while (queue.length > 0) {
    const words = queue.shift().map((w) => w.t);
    let i = 0;
    while (i < words.length && (assignment.test(words[i]) || PREFIX.has(stem(words[i])))) {
      i += 1;
      while (i < words.length && carried(words[i])) {
        i += VALUED.has(words[i]) ? 2 : 1;
      }
    }
    if (i >= words.length) continue;
    const prog = stem(words[i]);
    const rest = words.slice(i + 1);
    const lower = rest.map((w) => w.toLowerCase());
    const operands = rest.filter((w) => w.charAt(0) !== "-" && !assignment.test(w));
    if (SHELLS.has(prog)) {
      const k = lower.findIndex((w) => w === "-c" || w === "-command" || w === "/c" || w === "/k");
      if (k >= 0) for (const seg of scan(rest.slice(k + 1).join(" "))) queue.push(seg);
    }

    if (!SEARCH.has(prog) && DUMPS.some((r) => r.test(words.slice(i).join(" ")))) return "deny";
    if (READERS.has(prog)) {
      // A searcher takes its pattern first, and process.env is a pattern before it is a file.
      for (const w of SEARCH.has(prog) ? operands.slice(1) : operands) {
        if (EXT.has(tail(w))) return "deny";
      }
    }
    // eval runs a string assembled at run time, which is the one shape no text scan reads.
    if (prog === "eval") return "deny";
    // env with an operand runs a program; env with none prints the environment.
    if (prog === "env" && operands.length === 0) return "deny";
    // An operand carrying an expansion names a variable only at run time, which is a name this
    // scan never sees.
    if (prog === "printenv" && (operands.length === 0 || operands.some(credVar) ||
      operands.some((w) => w.indexOf("$") >= 0 || w.indexOf("%") >= 0))) return "deny";
    // xargs builds the operand from its input, so the program it repeats is what decides.
    if (prog === "xargs" && lower.some((w) => w === "env" || w === "printenv")) return "deny";
    // A bare dump, or the -p that makes each of these print instead of act. set -euo pipefail and
    // export FOO=1 both carry a word past the flags and are left alone.
    if (["set", "export", "declare", "typeset"].indexOf(prog) >= 0) {
      if (operands.length === 0 && rest.every((w) => w === "-p")) return "deny";
      // declare -p NAME prints one variable, which is the dump narrowed to the one that matters.
      if (operands.some(credVar)) return "deny";
    }
    // Encoding is named in section 1 as a route of its own, and nothing in this repository needs
    // either program. certutil is the Windows spelling of the same step.
    if (prog === "base64" || prog === "base32") return "deny";
    if (prog === "certutil" && lower.some((w) => w === "-encode" || w === "-decode")) return "deny";
    if (prog === "compgen" && lower.indexOf("-e") >= 0) return "deny";
    // inspect renders Config.Env; exec runs inside a container where the env_file is loaded.
    if (["docker", "podman", "docker-compose", "nerdctl"].indexOf(prog) >= 0) {
      if (lower.indexOf("inspect") >= 0 || lower.indexOf("exec") >= 0) return "deny";
      if (lower.indexOf("config") >= 0) return "deny";
    }
    if (prog === "gh" && lower[0] === "auth" && lower.indexOf("token") >= 0) return "deny";
    if (prog === "gh" && lower.indexOf("--show-token") >= 0) return "deny";
    if (["npm", "pnpm", "yarn"].indexOf(prog) >= 0 && lower.indexOf("token") >= 0) return "deny";
    if (prog === "kubectl" && lower.indexOf("config") >= 0 && lower.indexOf("view") >= 0) return "deny";
    if (prog === "aws" && lower.indexOf("configure") >= 0 && lower.indexOf("get") >= 0) return "deny";
    if (prog === "cmdkey" && lower.indexOf("/list") >= 0) return "deny";
  }

  if (!searching && DUMPS.some((r) => r.test(unquoted))) return "deny";

  // The cwd goes back with them: git is asked from where the command would run, not from where
  // the hook happens to be.
  return candidates.length > 0 ? ["check", cwd].concat(candidates).join("\n") : "allow";
};

let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let c;
  let cwd;
  try {
    const p = JSON.parse(s);
    c = p && typeof p === "object" && p.tool_input ? p.tool_input.command : undefined;
    cwd = p && typeof p === "object" && typeof p.cwd === "string" && p.cwd !== "" ? p.cwd : process.cwd();
  } catch {
    process.stdout.write("deny");
    return;
  }
  // A payload carrying no command string is a question nobody answered.
  process.stdout.write(typeof c === "string" ? decide(c, cwd) : "deny");
});
' 2>/dev/null)"

LF="
"
decision="${verdict%%"$LF"*}"
case "$decision" in
  allow) exit 0 ;;
  check) ;;
  # Anything but an explicit answer refuses, which covers node absent and node crashed alike.
  *) deny ;;
esac

# Section 1 puts every gitignored path off-limits, and git is the one reader of the ignore files
# that cannot drift from them. git missing is no answer; a cwd outside any repository is one.
command -v git >/dev/null 2>&1 || deny
rest="${verdict#check}"
rest="${rest#"$LF"}"
cwd="${rest%%"$LF"*}"
paths="${rest#*"$LF"}"
[ -n "$cwd" ] && [ "$paths" != "$rest" ] && [ -n "$paths" ] || exit 0
# The harness names the project it runs in, which is the root whenever the cwd sits inside it;
# git is asked only from a cwd elsewhere, such as a worktree of its own.
root=""
project="${CLAUDE_PROJECT_DIR:-}"
project="${project//\\//}"
project="${project%/}"
if [ -n "$project" ]; then
  case "${cwd,,}/" in
    "${project,,}/"*) root="$project" ;;
  esac
fi
[ -n "$root" ] || root="$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null)"
[ -n "$root" ] || exit 0
# Only a path inside the root goes to git: one outside it aborts the whole batch, and a path git
# never saw would then read as unplaced. Folded, because a Windows path is case-blind.
inside=""
while IFS= read -r p; do
  case "${p,,}" in
    "${root,,}/"*) inside="${inside}${p}${LF}" ;;
  esac
done <<<"$paths"
[ -n "$inside" ] || exit 0
ignored="$(printf '%s' "$inside" | git -c core.quotepath=false -C "$root" check-ignore --stdin 2>/dev/null)"
status=$?
# 0 is a hit, 1 is none; anything else is a question git did not answer.
[ "$status" -le 1 ] || deny
[ -n "$ignored" ] || exit 0
while IFS= read -r p; do
  [ -n "$p" ] || continue
  rel="${p:$((${#root} + 1))}"
  # Dependencies and build output are ignored too, and section 4 sends a session into
  # node_modules on purpose; the two paths section 1 exempts by name stay readable as well.
  case "$rel" in
    node_modules | node_modules/* | */node_modules | */node_modules/*) continue ;;
    .venv | .venv/* | */.venv | */.venv/*) continue ;;
    .next | .next/* | */.next | */.next/*) continue ;;
    .claude/worktrees | .claude/worktrees/*) continue ;;
    docs/audit | docs/audit/* | .vscode | .vscode/*) continue ;;
  esac
  deny_ignored "$rel"
done <<<"$ignored"

exit 0
