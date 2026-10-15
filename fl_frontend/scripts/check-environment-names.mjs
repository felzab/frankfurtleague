import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

// `scripts/lib/_lib.sh :: ENV_LINE_RE` spelled again, `scripts/tests/test_deploy_streams.py` holding
// the two to one verdict per line: a deploy's preflight refuses every other line before this runs.
const STRICT_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=[\]A-Za-z0-9_.~:/?[@!&()*+,;=%-]*$/;

// A line break python-dotenv or `@next/env` takes and compose does not, or a NUL `_lib.sh` cannot
// read: unreadable on any line, a comment's included.
const SPLIT = /[\r\u2028\u2029\0]/;

// Where `fl_frontend/Dockerfile` puts the key sets the builder emitted from the schema. The file to
// judge has no default: the deploy hands the package's own `.env`, mounted read-only
// (`scripts/ops/deploy.sh :: check_frontend_env_names`, `:: read_env_names`).
export const DECLARED_NAMES_FILE = "/app/environment-names.json";

/** Each line outside `STRICT_LINE`, a BOM-led first line among them, is `unreadable`: the advisory rather than the refusal (`docs/ops/spec.md` §1.5). */
export function scanNames(text) {
  const lines = new Map();
  const unreadable = [];

  text.split("\n").forEach((raw, index) => {
    // One carriage return, the line terminator `_lib.sh` drops too, so the two count alike.
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (SPLIT.test(line)) {
      unreadable.push(index + 1);
      return;
    }
    if (/^[ \t]*$/.test(line) || line.startsWith("#")) return;

    const declaration = STRICT_LINE.exec(line);
    if (declaration === null) unreadable.push(index + 1);
    else lines.set(declaration[1], [...(lines.get(declaration[1]) ?? []), index + 1]);
  });

  return { names: [...lines.keys()].sort(), lines: Object.fromEntries(lines), unreadable };
}

/** A `NEXT_PUBLIC_` name is judged here like any other: the client schema declares none, so one in the file reaches no bundle. */
export function undeclaredLines(lines, declared) {
  const known = new Set(declared);
  return Object.entries(lines)
    .filter(([name]) => !known.has(name))
    .flatMap(([, at]) => at)
    .sort((a, b) => a - b);
}

function missingNames(found, required) {
  const present = new Set(found);
  return required.filter((name) => !present.has(name));
}

function report(argv) {
  const [file, declaredFile = DECLARED_NAMES_FILE] = argv;
  // 4, not a pass: a reader handed nothing to read has judged nothing.
  if (file === undefined) {
    process.stderr.write("no environment file named\n");
    return 4;
  }
  const sets = JSON.parse(readFileSync(declaredFile, "utf8"));
  const { names, lines, unreadable } = scanNames(readFileSync(file, "utf8"));

  // Judged before the names are, and answered with line numbers rather than lines: a file this
  // cannot read whole is a file whose undeclared names would be guesses, and every line holds a value.
  if (unreadable.length > 0) {
    process.stderr.write(`line(s) this reader cannot parse: ${unreadable.join(", ")}\n`);
    return 4;
  }

  const undeclared = undeclaredLines(lines, sets.declared);
  const missing = missingNames(names, sets.required);
  if (undeclared.length === 0 && missing.length === 0) return 0;

  // Both lines where both apply: one run of the preflight is one visit to the host, and a remedy
  // held back until the next run is a second recreate to reach it.

  // An undeclared name is the file's own text, a pasted key's line keeping the shape among them, so
  // it goes by number; a required name is the schema's, so it is named.
  if (undeclared.length > 0)
    process.stderr.write(`Undeclared environment variables on ${undeclared.length} line(s): ${undeclared.join(", ")}\n`);
  if (missing.length > 0) process.stderr.write(`Missing required environment variables: ${missing.join(", ")}\n`);
  return 3;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // 3 is the one code the deploy grades as a refusal; every other ending leaves it standing where it
  // stood, so a checker that could not run costs nobody a deploy.
  let code = 4;
  try {
    code = report(process.argv.slice(2));
  } catch (unexpected) {
    // The CLASS alone: a file-system error quotes the path it could not read and a JSON one quotes
    // the bytes it choked on, and both reach a deploy log.
    process.stderr.write(`${unexpected instanceof Error ? unexpected.constructor.name : "unknown failure"}\n`);
  }
  process.exit(code);
}
