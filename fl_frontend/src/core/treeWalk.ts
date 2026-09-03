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
    // No flag turns this off. `fl_frontend/src/core/apiRequests.test.ts` reaches one listing by this
    // walk and the other by a flat one, and a mode serving both would leave two routes required to
    // agree sharing the reader whose failure they exist to catch (`docs/_standard/standard.md` PRE-4).
    if (entry.isDirectory()) return walk(full, accepts);

    // A name, never `full`: a predicate handed a path can read the file, and a population filtered
    // on the property its own sweep asserts can never fail (PRE-4).
    return accepts(entry.name) ? [full] : [];
  });
}

/**
 * Every file under `root` whose name `accepts` takes, absolute, recursively.
 *
 * `floor` is positional and has no default because a sweep that would report the same clean answer
 * over an empty list floors itself first (`docs/frontend/spec.md`), and a default is a floor nobody
 * chose. Set it under the population with room for ordinary product change: one set AT the count
 * fires on a file being retired, and whoever meets it next lowers it.
 */
export function filesUnder(root: string, accepts: (name: string) => boolean, floor: number): string[] {
  const found = walk(root, accepts);
  if (found.length < floor) {
    throw new Error(`${root} yielded ${String(found.length)} files, under this sweep's floor of ${String(floor)}`);
  }

  return found;
}
