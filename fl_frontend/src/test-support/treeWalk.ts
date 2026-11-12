import { readdirSync } from "node:fs";
import path from "node:path";

function walk(dir: string, accepts: (name: string) => boolean): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    // No flag turns this off: a walk that is sometimes flat hands two callers two populations under one name.
    if (entry.isDirectory()) return walk(full, accepts);

    // A name, never `full`: a predicate handed a path can read the file, and a population filtered
    // on the property its own sweep asserts can never fail.
    return accepts(entry.name) ? [full] : [];
  });
}

/**
 * Every file under `root` whose name `accepts` takes, absolute, recursively.
 *
 * `floor` is positional and undefaulted so no sweep can exist without naming one;
 * a default would be a floor nobody chose.
 */
export function filesUnder(root: string, accepts: (name: string) => boolean, floor: number): string[] {
  const found = walk(root, accepts);
  if (found.length < floor) {
    throw new Error(`${root} yielded ${String(found.length)} files, under this sweep's floor of ${String(floor)}`);
  }

  return found;
}
