// The reader behind `.claude/hooks/implementer-whole-suite.sh`, which says why it refuses and why it
// lets through what it cannot read. It knows the common forms only, each probed by
// `scripts/gate/selfcheck.sh` step 12: a form missing here is let through, never permitted.
const REFUSE = [
  "Targeted forms: pnpm run test:base <files> in fl_frontend; uv run --frozen pytest <paths> in fl_backend,",
  "and uv run --frozen pytest -m db <file>, one database file, where your brief allows database files.",
  "A question only a whole suite answers goes in your report under (d).",
].join(" ");
const RULE =
  "An implementer runs its targeted set and never a whole suite, the gate or the local stack " +
  "(.claude/agents/implementer.md section 5): CI runs every scope over the combined head once a wave lands.";

// Flags taking their value as the next word, skipped so that a value naming a file is not read as an
// operand. Narrowing is decided positively, so an unknown flag's value narrows nothing.
const NODE_VALUE = new Set(["--import", "--test-name-pattern"]);
const PYTEST_VALUE = new Set(["-m", "-k"]);
const UV_RUN_VALUE = new Set(["--project", "--directory"]);
const PNPM_VALUE = new Set(["-C", "--dir", "--filter"]);
// Flags with which pytest collects or answers and runs no test.
const RUNS_NO_TEST = new Set(["--collect-only", "--co", "--version", "-V", "--help", "-h"]);
const WRAPPERS = new Set(["time", "exec", "command", "!", "if", "then", "else", "do", "while", "until"]);
// A command substitution in an argument position: its output is read as an operand that narrows,
// and the command inside it is judged on its own.
const SUBSTITUTION = "\u0000substitution";

// The index of the parenthesis closing the one opened just before `from`, or -1.
function closing(text, from) {
  let depth = 1;
  for (let k = from; k < text.length; k++) {
    if (text[k] === "(") depth++;
    if (text[k] === ")" && --depth === 0) return k;
  }
  return -1;
}

// Words of each simple command, quotes resolved and redirections dropped: a redirect target read as
// an operand would let `pytest > log` through. PowerShell's backslash separates a path; its backtick
// escapes the next character, a newline included.
function segments(text, escapes) {
  const out = [];
  let words = [];
  let word = null;
  let drop = false;
  let heredocs = [];
  let i = 0;
  const push = () => {
    if (word !== null && !drop) words.push(word);
    if (word !== null) drop = false;
    word = null;
  };
  const end = () => {
    push();
    drop = false;
    if (words.length) out.push(words);
    words = [];
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "\n") {
      end();
      i++;
      // A heredoc body is skipped: a commit message fed through one may name a whole-suite command
      // it never runs.
      for (const delim of heredocs) {
        while (i < text.length) {
          let j = text.indexOf("\n", i);
          if (j === -1) j = text.length;
          const line = text.slice(i, j).replace(/\r$/, "").replace(/^\t+/, "");
          i = j + 1;
          if (line === delim) break;
        }
      }
      heredocs = [];
      continue;
    }
    if (c === " " || c === "\t" || c === "\r") {
      push();
      i++;
      continue;
    }
    if (c === "#" && word === null) {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === "'") {
      const j = text.indexOf("'", i + 1);
      if (j === -1) throw new Error("unterminated quote");
      word = (word ?? "") + text.slice(i + 1, j);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let s = "";
      while (j < text.length && text[j] !== '"') {
        if (escapes && text[j] === "\\" && j + 1 < text.length) {
          s += text[j + 1];
          j += 2;
          continue;
        }
        s += text[j++];
      }
      if (j >= text.length) throw new Error("unterminated quote");
      word = (word ?? "") + s;
      i = j + 1;
      continue;
    }
    if (escapes && c === "\\" && i + 1 < text.length) {
      if (text[i + 1] !== "\n") word = (word ?? "") + text[i + 1];
      i += 2;
      continue;
    }
    if (text.startsWith("<<", i)) {
      push();
      i += 2;
      while (text[i] === "-" || text[i] === " " || text[i] === "\t") i++;
      let delim = "";
      while (i < text.length && !/[\s;&|<>()]/.test(text[i])) {
        if (text[i] !== "'" && text[i] !== '"' && text[i] !== "\\") delim += text[i];
        i++;
      }
      if (delim) heredocs.push(delim);
      continue;
    }
    if (c === ">" || c === "<") {
      // A file descriptor written before the operator is no word of the command.
      if (word !== null && /^\d+$/.test(word)) word = null;
      push();
      i++;
      while (text[i] === ">") i++;
      if (text[i] === "&") {
        i++;
        while (i < text.length && /[0-9-]/.test(text[i])) i++;
        continue;
      }
      drop = true;
      continue;
    }
    if (!escapes && c === "`" && i + 1 < text.length) {
      if (text[i + 1] !== "\n") word = (word ?? "") + text[i + 1];
      i += 2;
      continue;
    }
    if (text.startsWith("$(", i) || (escapes && c === "`")) {
      const tick = c === "`";
      const j = tick ? text.indexOf("`", i + 1) : closing(text, i + 2);
      if (j === -1) throw new Error("unterminated substitution");
      out.push(...segments(text.slice(i + (tick ? 1 : 2), j), escapes));
      word = (word ?? "") + SUBSTITUTION;
      i = j + 1;
      continue;
    }
    if (";&|(){}".includes(c)) {
      end();
      i++;
      continue;
    }
    word = (word ?? "") + c;
    i++;
  }
  end();
  return out;
}

const isAssignment = (w) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(w);
const slashed = (w) => w.replace(/\\/g, "/");
const base = (w) => slashed(w).split("/").pop().toLowerCase();
// An operand narrows a run only by naming a test file, a `::` node id or a substitution's output: a
// directory, a recursive glob or anything else is read as the whole suite.
const namesTests = (w) => w.includes(SUBSTITUTION) || w.includes("::") || (!w.includes("**") && /\.(py|[cm]?[jt]sx?)$/i.test(w));

// The words left once every wrapper in front of the command proper is gone.
function unwrap(words) {
  let w = words.slice();
  for (;;) {
    while (w.length && (isAssignment(w[0]) || WRAPPERS.has(w[0]))) w.shift();
    if (!w.length) return w;
    const head = base(w[0]);
    if (head === "env" || head === "cross-env") {
      w.shift();
      while (w.length && isAssignment(w[0])) w.shift();
      continue;
    }
    if (head === "timeout") {
      w = w.slice(2);
      continue;
    }
    if (head === "uv" && w[1] === "run") {
      w = w.slice(2);
      while (w.length && w[0].startsWith("-")) {
        const flag = w.shift();
        if (UV_RUN_VALUE.has(flag)) w.shift();
      }
      continue;
    }
    if (head === "pnpm" && w[1] === "exec") {
      w = w.slice(2);
      continue;
    }
    return w;
  }
}

// The operands after the command that name tests, a flag's value skipped. `--` only ends the flags.
function testOperands(args, valueFlags) {
  const named = [];
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--") continue;
    if (a.startsWith("-")) {
      if (!a.includes("=") && valueFlags.has(a)) k++;
      continue;
    }
    if (namesTests(a)) named.push(a);
  }
  return named;
}

// The database tier holds a machine-wide lock, so it runs one named file at a time.
function databaseTier(args) {
  const m = args.findIndex((a) => a === "-m" || a.startsWith("-m="));
  if (m === -1) return false;
  const value = args[m].startsWith("-m=") ? args[m].slice(3) : (args[m + 1] ?? "");
  return /^\s*db\b/.test(value);
}

// What one simple command would run whole, or null; `depth` bounds a `bash -c` inside a `bash -c`.
function judge(words, depth, escapes) {
  const w = unwrap(words);
  if (!w.length) return null;
  const head = base(w[0]);
  if (head === "bash" || head === "sh") {
    // `-c`, alone or in a cluster such as `-lc`, makes the next word the command line.
    let k = 1;
    let script = false;
    while (k < w.length && /^-[a-z]+$/.test(w[k])) script ||= w[k++].includes("c");
    if (!script) return judge(w.slice(k), depth, escapes);
    if (k >= w.length || depth >= 3) return null;
    for (const inner of segments(w[k], escapes)) {
      const found = judge(inner, depth + 1, escapes);
      if (found) return found;
    }
    return null;
  }
  if (slashed(w[0]).endsWith("scripts/gate/verify.sh")) return "the gate";
  if (slashed(w[0]).endsWith("scripts/ops/local.sh")) return "the local stack";
  if (head === "pnpm" || head === "npm") {
    let k = 1;
    while (k < w.length && w[k].startsWith("-")) k += PNPM_VALUE.has(w[k]) ? 2 : 1;
    if (w[k] === "run") k++;
    // Both scripts put their own patterns in front of whatever follows, so no argument narrows them.
    if (w[k] === "test" || w[k] === "t") return "the whole frontend suite";
    if (w[k] === "test:db") return "the whole frontend database tier";
    if (w[k] === "test:base" && !testOperands(w.slice(k + 1), NODE_VALUE).length) return "every test file node finds";
    return null;
  }
  if (head === "node" && w.includes("--test")) {
    return testOperands(
      w.slice(1).filter((a) => a !== "--test"),
      NODE_VALUE,
    ).length
      ? null
      : "every test file node finds";
  }
  let pytestArgs = null;
  if (head === "pytest") pytestArgs = w.slice(1);
  if (head.startsWith("python")) {
    const m = w.indexOf("-m");
    if (m !== -1 && w[m + 1] === "pytest") pytestArgs = w.slice(m + 2);
  }
  if (pytestArgs === null || pytestArgs.some((a) => RUNS_NO_TEST.has(a))) return null;
  const named = testOperands(pytestArgs, PYTEST_VALUE);
  if (databaseTier(pytestArgs))
    return named.length === 1 && !named[0].includes(SUBSTITUTION) ? null : "the database tier on more than one named file";
  return named.length ? null : "the whole backend suite";
}

let raw = "";
process.stdin
  .on("data", (d) => (raw += d))
  .on("end", () => {
    try {
      const j = JSON.parse(raw);
      if (j.agent_type !== "implementer") return;
      const command = j.tool_input && j.tool_input.command;
      if (typeof command !== "string") return;
      const escapes = j.tool_name !== "PowerShell";
      for (const words of segments(command, escapes)) {
        const what = judge(words, 0, escapes);
        if (what) {
          process.stderr.write(
            'Refused by .claude/hooks/implementer-whole-suite.sh: "' + words.join(" ") + '" runs ' + what + ". " + RULE + "\n" + REFUSE + "\n",
          );
          process.exitCode = 2;
          return;
        }
      }
    } catch {
      // Unreadable input is let through, for the reason the shell script's header gives.
    }
  });
