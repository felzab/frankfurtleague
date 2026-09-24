import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// Run twice from the committing tree's `fl_frontend`, as `pnpm format` runs prettier: `format`
// before the index is written, `write` only after both index writes succeed, so a refused commit
// leaves no working copy formatted.
const [mode, work] = process.argv.slice(2);

// One record per staged file: `W` fully staged, `P` staged in part, then its path from the root.
const fields = readFileSync(path.join(work, "manifest"), "utf8").split("\0");
const files = [];
for (let at = 0; at + 1 < fields.length; at += 2) files.push({ whole: fields[at] === "W", rel: fields[at + 1] });

const indices = (name) => readFileSync(path.join(work, name), "utf8").split("\0").filter(Boolean).map(Number);
const list = (name, values) => writeFileSync(path.join(work, name), values.map((index) => `${index}\0`).join(""));

if (mode === "write") {
  const raced = [];
  const unwritten = [];
  for (const index of indices("rewrite")) {
    const file = path.resolve("..", files[index].rel);
    // Re-read at the write, so a save landing since the working copy was read is kept; only the
    // moment between this read and the write stays open, as it does inside `prettier --write`.
    let current;
    try {
      current = readFileSync(file);
    } catch {
      current = null;
    }
    if (current === null || !current.equals(readFileSync(path.join(work, "read", String(index))))) {
      raced.push(index);
      continue;
    }
    try {
      writeFileSync(file, readFileSync(path.join(work, "rewritten", String(index))));
    } catch {
      unwritten.push(index);
    }
  }
  list("raced-late", raced);
  list("unwritten", unwritten);
  process.exit(0);
}

// The two plugins `.prettierrc.json` names resolve from the working directory, and prettier from here.
const prettier = createRequire(path.resolve("package.json"))("prettier");
const ignorePath = path.resolve("../.prettierignore");

// `git cat-file --batch` output, in the manifest's order: a header line, the raw blob, a newline.
const blobs = readFileSync(path.join(work, "blobs"));
let offset = 0;
function nextBlob(rel) {
  const end = blobs.indexOf(0x0a, offset);
  const [, type, size] = blobs.toString("latin1", offset, end).split(" ");
  if (type !== "blob") throw new Error(`the staged copy of ${rel} is not a blob`);
  const body = blobs.subarray(end + 1, end + 1 + Number(size));
  offset = end + 2 + Number(size);
  return body;
}

// What `prettier --write --ignore-unknown --ignore-path ../.prettierignore` would do to one text:
// null where the CLI leaves the file alone.
async function formatted(file, text) {
  const { ignored, inferredParser } = await prettier.getFileInfo(file, { ignorePath });
  if (ignored || inferredParser === null) return null;
  // The CLI reads `.editorconfig` by default and the API does not.
  const options = await prettier.resolveConfig(file, { editorconfig: true });
  return prettier.format(text, { ...options, filepath: file });
}

const restage = [];
const raced = [];
const rewrites = [];
let unparsed = 0;

for (const [index, { whole, rel }] of files.entries()) {
  const file = path.resolve("..", rel);
  const staged = nextBlob(rel).toString("utf8");
  let output;
  try {
    output = await formatted(file, staged);
  } catch (error) {
    // A file that will not parse is a verdict on it alone, so every one is named; anything else,
    // a missing plugin or a bad config, is the tree's and ends the run.
    if (!error?.loc) throw error;
    console.error(`[error] ${rel}: ${String(error)}`);
    unparsed += 1;
    continue;
  }
  if (output === null) continue;
  if (output !== staged) restage.push({ index, output });
  // Never a file staged in part, not even one whose working copy formats to the staged result: its
  // working copy is the author's alone (`docs/ops/spec.md :: I354`).
  if (!whole) continue;

  let onDisk;
  try {
    onDisk = readFileSync(file);
  } catch {
    raced.push(index);
    continue;
  }
  const text = onDisk.toString("utf8");
  if (text === output) continue;
  // Anything but the staged text, or the LF form `.gitattributes` stores it as, was written after
  // git listed the stage, even an edit changing formatting alone, and is left as it is.
  if (text === staged || text.replaceAll("\r\n", "\n") === staged) rewrites.push({ index, onDisk, output });
  else raced.push(index);
}

if (unparsed > 0) process.exit(2);

for (const directory of ["formatted", "read", "rewritten"]) mkdirSync(path.join(work, directory));
for (const { index, output } of restage) writeFileSync(path.join(work, "formatted", String(index)), output);
for (const { index, onDisk, output } of rewrites) {
  writeFileSync(path.join(work, "read", String(index)), onDisk);
  writeFileSync(path.join(work, "rewritten", String(index)), output);
}
list(
  "restage",
  restage.map(({ index }) => index),
);
list("raced", raced);
list(
  "rewrite",
  rewrites.map(({ index }) => index),
);
