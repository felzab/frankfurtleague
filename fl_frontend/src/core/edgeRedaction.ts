import { readFileSync } from "node:fs";
import path from "node:path";

// The production file and never the local one: `nginx/local.conf` mirrors it under
// `scripts/checks/check_nginx_mirror.py`, and the access line a credential could reach is served
// by this one.
const EDGE_CONFIG = path.resolve(import.meta.dirname, "..", "..", "..", "nginx", "prod.conf");

/** The alternation each arm of the map matches on, one entry per arm, in the file's order. */
function armAlternations(arms: string): string[][] {
  return arms
    .split("\n")
    .filter((line) => line.trim().startsWith('"~'))
    .map((line) => [...line.matchAll(/\(([a-z]+(?:\|[a-z]+)+)\)/g)].flatMap((treffer) => (treffer[1] ?? "").split("|")));
}

// In `core` rather than `shared/testing`: three of the five callers are `core`'s own tests, and
// `eslint.config.mjs :: LAYER_BOUNDARY` lets nothing there reach `shared`. It reads the tree off
// disk, so `:: TEST_ONLY` keeps production code out.

/** The query-parameter names the edge redacts in EVERY arm of its map. */
export function redactedParameterNames(): string[] {
  const config = readFileSync(EDGE_CONFIG, "utf8");
  const block = config.slice(config.indexOf("map $request_uri $credential_free_uri {"));
  const [erste, ...weitere] = armAlternations(block.slice(0, block.indexOf("}")));

  // The intersection rather than the union: the first arm keeps the path and replaces the query
  // alone, so a name only the arms below it hold costs every access line its path.

  // Empty where the map was read as having no arm at all, which each caller's own floor reports.
  return erste === undefined ? [] : erste.filter((name) => weitere.every((arm) => arm.includes(name)));
}
