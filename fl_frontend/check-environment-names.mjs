import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const ASSIGNMENT = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*=/;

// Compose's pass-through form, taking the value from the shell that ran it rather than from this
// file. It declares the name all the same, so a typo written this way is the fault this refuses.
const PASSTHROUGH = /^[ \t]*([A-Za-z_][A-Za-z0-9_]*)[ \t]*$/;

// Where `fl_frontend/Dockerfile` puts the two: the WORKDIR the mount lands in, and the key set the
// builder emitted from the schema (`scripts/ops/deploy.sh :: check_frontend_env_names`).
export const ENVIRONMENT_FILE = "/app/.env";
export const DECLARED_NAMES_FILE = "/app/environment-names.json";

/** A backslash escapes either quote, the single one included: compose documents `VAR='Let\'s go!'`, and closing on that quote reads the value's next line as a declaration. */
function endOfQuoted(value, quote, from) {
  for (let index = from; index < value.length; index += 1) {
    if (value[index] === "\\") {
      index += 1;
      continue;
    }
    if (value[index] === quote) return index + 1;
  }
  return -1;
}

// Narrower than compose deliberately: `export KEY=`, `KEY: value`, a BOM and a name outside
// `ASSIGNMENT` all land in `unreadable`, which answers the advisory rather than the refusal
// (`docs/ops/spec.md` §1.5).
/**
 * A quoted value running past its own line is skipped whole: compose accepts one, and a `KEY=value`
 * written inside it is that value's data rather than a declaration.
 */
export function scanNames(text) {
  const names = new Set();
  const unreadable = [];
  let open = "";
  let openedAt = 0;

  text.split(/\r?\n/).forEach((line, index) => {
    if (open !== "") {
      if (endOfQuoted(line, open, 0) >= 0) open = "";
      return;
    }

    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) return;

    const assigned = ASSIGNMENT.exec(line);
    if (assigned !== null) {
      names.add(assigned[1]);
      const value = line.slice(assigned[0].length).trimStart();
      const quote = value[0];
      if ((quote === '"' || quote === "'") && endOfQuoted(value, quote, 1) < 0) {
        open = quote;
        openedAt = index + 1;
      }
      return;
    }

    const passed = PASSTHROUGH.exec(line);
    if (passed !== null) {
      names.add(passed[1]);
      return;
    }

    unreadable.push(index + 1);
  });

  // Compose refuses a file whose quote never closes; swallowed here, it would answer 0 over a file
  // whose every name below this line went unread.
  if (open !== "") unreadable.push(openedAt);

  return { names: [...names].sort(), unreadable };
}

/** A `NEXT_PUBLIC_` name is judged here like any other: the client schema declares none, so one in the file reaches no bundle. */
export function undeclaredNames(found, declared) {
  const known = new Set(declared);
  return found.filter((name) => !known.has(name));
}

function report(argv) {
  const [file = ENVIRONMENT_FILE, declaredFile = DECLARED_NAMES_FILE] = argv;
  const declared = JSON.parse(readFileSync(declaredFile, "utf8"));
  const { names, unreadable } = scanNames(readFileSync(file, "utf8"));

  // Judged before the names are, and answered with line numbers rather than lines: a file this
  // cannot read whole is a file whose undeclared names would be guesses, and every line holds a value.
  if (unreadable.length > 0) {
    process.stderr.write(`line(s) this reader cannot parse: ${unreadable.join(", ")}\n`);
    return 4;
  }

  const undeclared = undeclaredNames(names, declared);
  if (undeclared.length === 0) return 0;

  process.stderr.write(`Undeclared environment variables: ${undeclared.join(", ")}\n`);
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
