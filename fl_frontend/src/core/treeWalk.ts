import { readdirSync } from "node:fs";
import path from "node:path";

/**
 * Both spellings, decided once. `.test.ts` is a strict prefix of `.test.tsx`, which is how an
 * exclusion written for one suffix misses half of what it was written for
 * (`.claude/rules/frontend.md`).
 */
export function isTestFile(name: string): boolean {
  return /\.test\.tsx?$/.test(name);
}

function walk(dir: string, accepts: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    // No flag turns this off: `fl_frontend/src/core/apiRequests.test.ts` reaches one listing by this
    // walk and the other by a flat one, and PRE-4 (`docs/_standard/standard.md`) is what a reader
    // serving both would break.
    if (entry.isDirectory()) return walk(full, accepts);

    // A name, never `full`: a predicate handed a path can read the file, and a population filtered
    // on the property its own sweep asserts can never fail (PRE-4).
    return accepts(entry.name) ? [full] : [];
  });
}

/**
 * Every file under `root` whose name `accepts` takes, absolute, recursively.
 *
 * `floor` is positional and undefaulted so no sweep can exist without naming one
 * (`docs/frontend/spec.md`); a default would be a floor nobody chose.
 */
export function filesUnder(root: string, accepts: (name: string) => boolean, floor: number): string[] {
  const found = walk(root, accepts);
  if (found.length < floor) {
    throw new Error(`${root} yielded ${String(found.length)} files, under this sweep's floor of ${String(floor)}`);
  }

  return found;
}
