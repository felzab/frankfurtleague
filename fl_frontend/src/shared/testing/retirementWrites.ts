import { readFileSync } from "node:fs";

import { serverActionModules } from "@/core/treeWalk.ts";

const RETIREMENT_EXPORT = /^export (?:async function|function|const) (delete|reactivate)([A-Z]\w*)Action\b/gm;

/**
 * Every write retiring a record or returning it, read off the server actions rather than off a sweep's own cases: a
 * record is retirable where one noun exports both `delete<X>Action` and `reactivate<X>Action`.
 */
export function retirementWrites(): string[] {
  const kinds = new Map<string, Set<string>>();
  for (const file of serverActionModules(20)) {
    for (const [, kind = "", noun = ""] of readFileSync(file, "utf8").matchAll(RETIREMENT_EXPORT)) {
      kinds.set(noun, (kinds.get(noun) ?? new Set()).add(kind));
    }
  }

  return [...kinds]
    .filter(([, found]) => found.size === 2)
    .flatMap(([noun]) => [`delete${noun}Action`, `reactivate${noun}Action`])
    .sort();
}
