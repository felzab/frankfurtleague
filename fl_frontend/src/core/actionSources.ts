import { readFileSync } from "node:fs";
import path from "node:path";

import { filesUnder } from "@/core/treeWalk.ts";

const SRC_DIR = path.resolve(import.meta.dirname, "..");

/** A listed file this reader cannot open fails the run: a population that drops it stays green for the file nobody read. */
function read(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch (cause) {
    throw new Error(`${file} was listed by the walk and could not be read`, { cause });
  }
}

let walked: ReadonlyMap<string, string> | null = null;

/**
 * Every `.ts` and `.tsx` under `src`, keyed by its path relative to `src`. Test files are IN: a
 * slice's sweep is itself a test file.
 *
 * Behind a call rather than a module constant, so importing this module reads no tree.
 */
export function sources(): ReadonlyMap<string, string> {
  walked ??= new Map(
    filesUnder(SRC_DIR, (name) => name.endsWith(".ts") || name.endsWith(".tsx"), 400).map((file) => [
      path.relative(SRC_DIR, file).split(path.sep).join("/"),
      read(file),
    ]),
  );

  return walked;
}
