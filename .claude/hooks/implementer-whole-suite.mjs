// The reader behind `.claude/hooks/implementer-whole-suite.sh`, which says why it refuses and why it
// lets through what it cannot read. Word lists rather than grammars: a form missing here is a call
// let through, the direction that hook fails in by choice.
const REFUSE = [
  "Targeted forms: pnpm run test:base <files> in fl_frontend; uv run --frozen pytest <paths> in fl_backend,",
  "and uv run --frozen pytest -m db <file> where your brief allows a database file.",
  "A question only a whole suite answers goes in your report under (d).",
].join(" ");
const RULE =
  "An implementer runs its targeted set and never a whole suite, the gate or the local stack " +
  "(.claude/agents/implementer.md section 5): CI runs every scope over the combined head once a batch lands.";

// Flags taking their value as the next word; an unknown flag is read as taking none, so its value
// counts as an operand and the call is let through.
const NODE_VALUE = new Set([
  "--import",
  "--require",
  "-r",
  "--loader",
  "--experimental-loader",
  "--conditions",
  "-C",
  "--env-file",
  "--disable-warning",
  "--test-reporter",
  "--test-reporter-destination",
  "--test-name-pattern",
  "--test-skip-pattern",
  "--test-concurrency",
  "--test-shard",
  "--test-timeout",
]);
const PYTEST_VALUE = new Set([
  "-m",
  "-k",
  "-p",
  "-c",
  "-o",
  "-W",
  "-n",
  "-r",
  "--maxfail",
  "--tb",
  "--rootdir",
  "--basetemp",
  "--confcutdir",
  "--override-ini",
  "--junitxml",
  "--junit-xml",
  "--deselect",
  "--ignore",
  "--ignore-glob",
  "--durations",
  "--durations-min",
  "--log-level",
  "--log-cli-level",
  "--log-file",
  "--import-mode",
  "--capture",
  "--color",
  "--dist",
  "--maxprocesses",
  "--timeout",
  "--cov",
  "--cov-report",
]);
const UV_RUN_VALUE = new Set([
  "--project",
  "--directory",
  "--with",
  "--with-requirements",
  "--python",
  "-p",
  "--package",
  "--extra",
  "--group",
  "--only-group",
  "--env-file",
  "--index",
  "--default-index",
]);
const PNPM_VALUE = new Set(["-C", "--dir", "--filter", "-F", "--reporter", "--loglevel"]);
const PYTHON_VALUE = new Set(["-X", "-W"]);
const COLLECT_ONLY = new Set(["--collect-only", "--co"]);
const WRAPPERS = new Set(["time", "nice", "nohup", "exec", "command", "builtin", "if", "while", "until", "do", "then", "else", "elif", "!"]);

// Words of each simple command, quotes resolved and redirections dropped: a redirect target read as
// an operand would let `pytest > log` through.
function segments(text) {
  const out = [];
  let words = [];
  let word = null;
  let drop = false;
  let pendingHeredocs = [];
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
      for (const { delim, strip } of pendingHeredocs) {
        while (i < text.length) {
          let j = text.indexOf("\n", i);
          if (j === -1) j = text.length;
          let line = text.slice(i, j).replace(/\r$/, "");
          if (strip) line = line.replace(/^\t+/, "");
          i = j + 1;
          if (line === delim) break;
        }
      }
      pendingHeredocs = [];
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
        if (text[j] === "\\" && j + 1 < text.length) {
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
    if (c === "\\" && i + 1 < text.length) {
      if (text[i + 1] === "\n") {
        i += 2;
        continue;
      }
      word = (word ?? "") + text[i + 1];
      i += 2;
      continue;
    }
    if (c === ">" || (c === "<" && text[i + 1] !== "<")) {
      // A file descriptor written before the operator is no word of the command.
      if (word !== null && /^\d+$/.test(word)) word = null;
      push();
      i++;
      while (text[i] === ">" || text[i] === "|") i++;
      if (text[i] === "&") {
        i++;
        while (i < text.length && /[0-9-]/.test(text[i])) i++;
        continue;
      }
      drop = true;
      continue;
    }
    if (text.startsWith("<<<", i)) {
      push();
      i += 3;
      continue;
    }
    if (text.startsWith("<<", i)) {
      push();
      i += 2;
      let strip = false;
      if (text[i] === "-") {
        strip = true;
        i++;
      }
      while (text[i] === " " || text[i] === "\t") i++;
      let delim = "";
      while (i < text.length && !/[\s;&|<>()]/.test(text[i])) {
        if (text[i] !== "'" && text[i] !== '"' && text[i] !== "\\") delim += text[i];
        i++;
      }
      if (delim) pendingHeredocs.push({ delim, strip });
      continue;
    }
    if (text.startsWith("$(", i)) {
      end();
      i += 2;
      continue;
    }
    if (";&|()`{}".includes(c)) {
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
const base = (w) =>
  w
    .replace(/\\/g, "/")
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/\.(exe|cmd|ps1|bat)$/, "");

// The words left once every wrapper in front of the command proper is gone.
function unwrap(words) {
  let w = words.slice();
  for (;;) {
    while (w.length && (isAssignment(w[0]) || WRAPPERS.has(w[0]))) w.shift();
    if (!w.length) return w;
    const head = base(w[0]);
    if (head === "env" || head === "cross-env") {
      w.shift();
      while (w.length && (isAssignment(w[0]) || w[0].startsWith("-"))) w.shift();
      continue;
    }
    if (head === "timeout") {
      w.shift();
      while (w.length && w[0].startsWith("-")) w.shift();
      w.shift();
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
    if ((head === "pnpm" && (w[1] === "exec" || w[1] === "dlx")) || head === "npx" || head === "pnpx") {
      w = w.slice(head === "pnpm" ? 2 : 1);
      continue;
    }
    return w;
  }
}

// True where a word after the command is an operand rather than a flag or a flag value.
function hasOperand(args, valueFlags) {
  for (let k = 0; k < args.length; k++) {
    const a = args[k];
    if (a === "--") return k + 1 < args.length;
    if (a.startsWith("-")) {
      if (!a.includes("=") && valueFlags.has(a)) k++;
      continue;
    }
    return true;
  }
  return false;
}

// What one simple command would run whole, or null; `depth` bounds a `bash -c` inside a `bash -c`.
function judge(words, depth) {
  const w = unwrap(words);
  if (!w.length) return null;
  const head = base(w[0]);
  const path = w[0].replace(/\\/g, "/");
  if ((head === "bash" || head === "sh") && w[1] === "-c" && w.length > 2 && depth < 3) {
    for (const inner of segments(w[2])) {
      const found = judge(inner, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (head === "bash" || head === "sh") return judge(w.slice(1), depth);
  if (path.endsWith("scripts/gate/verify.sh")) return "the gate";
  if (path.endsWith("scripts/ops/local.sh")) return "the local stack";
  if (head === "pnpm") {
    let k = 1;
    while (k < w.length && w[k].startsWith("-")) {
      if (PNPM_VALUE.has(w[k])) k++;
      k++;
    }
    let script = w[k];
    if (script === "run" || script === "run-script") {
      k++;
      while (k < w.length && w[k].startsWith("-")) k++;
      script = w[k];
    }
    // Both scripts put their own patterns in front of whatever follows, so no argument narrows them.
    if (script === "test" || script === "t") return "the whole frontend suite";
    if (script === "test:db") return "the whole frontend database tier";
    if (script === "test:base" && !hasOperand(w.slice(k + 1), NODE_VALUE)) return "every test file node finds";
    return null;
  }
  if (head === "node") {
    const at = w.findIndex((a) => a === "--test" || a.startsWith("--test="));
    if (at === -1) return null;
    const args = w.slice(1).filter((a) => a !== "--test");
    if (!hasOperand(args, NODE_VALUE)) return "every test file node finds";
    return null;
  }
  let pytestArgs = null;
  if (head === "pytest" || head === "py.test") pytestArgs = w.slice(1);
  if (head.startsWith("python") || head === "py") {
    let k = 1;
    while (k < w.length && w[k].startsWith("-") && w[k] !== "-m") {
      if (PYTHON_VALUE.has(w[k])) k++;
      k++;
    }
    if (w[k] === "-m" && w[k + 1] === "pytest") pytestArgs = w.slice(k + 2);
  }
  if (pytestArgs !== null) {
    if (pytestArgs.some((a) => COLLECT_ONLY.has(a))) return null;
    if (!hasOperand(pytestArgs, PYTEST_VALUE)) return "the whole backend suite";
  }
  return null;
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
      for (const words of segments(command)) {
        const what = judge(words, 0);
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
