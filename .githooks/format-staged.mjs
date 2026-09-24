import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// `.githooks/pre-commit` runs this from `fl_frontend`, as `pnpm format` runs prettier: the two
// plugins `.prettierrc.json` names resolve from the working directory, and prettier from here.
const prettier = createRequire(path.resolve("package.json"))("prettier");

const work = process.argv[2];
const ignorePath = path.resolve("../.prettierignore");

// One record per staged file: `W` fully staged, `P` staged in part, then its path from the root.
const fields = readFileSync(path.join(work, "manifest"), "utf8").split("\0");
const files = [];
for (let at = 0; at + 1 < fields.length; at += 2) files.push({ whole: fields[at] === "W", rel: fields[at + 1] });

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
    continue;
  }
  const text = onDisk.toString("utf8");
  // A working copy that formats to anything else holds bytes nobody staged, written after git
  // listed the stage; it is left as it is. A CRLF copy of the staged text formats the same.
  let diskOutput;
  try {
    diskOutput = text === staged ? output : await formatted(file, text);
  } catch {
    diskOutput = undefined;
  }
  if (diskOutput !== output) raced.push(index);
  else if (text !== output) rewrites.push({ index, file, onDisk, output });
}

// A refused commit leaves the working tree as it found it.
if (unparsed > 0) process.exit(2);

mkdirSync(path.join(work, "formatted"));
for (const { index, output } of restage) writeFileSync(path.join(work, "formatted", String(index)), output);

for (const { index, file, onDisk, output } of rewrites) {
  // Re-read at the write, so a save landing while the batch formatted is kept; only the moment
  // between this read and the write stays open, as it does inside `prettier --write`.
  let current;
  try {
    current = readFileSync(file);
  } catch {
    current = null;
  }
  if (current === null || !current.equals(onDisk)) raced.push(index);
  else writeFileSync(file, output);
}

writeFileSync(path.join(work, "restage"), restage.map(({ index }) => `${index}\0`).join(""));
writeFileSync(path.join(work, "raced"), raced.map((index) => `${index}\0`).join(""));
