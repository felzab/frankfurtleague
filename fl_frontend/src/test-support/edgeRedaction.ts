import { readFileSync } from "node:fs";
import path from "node:path";

import { assert } from "vitest";

// The http-level file both edges include, so the map read here is the one production serves.
const EDGE_CONFIG = path.resolve(import.meta.dirname, "..", "..", "..", "nginx", "shared", "http.conf");

/** The alternation each arm of the map matches on, one entry per arm, in the file's order. */
function armAlternations(arms: string): string[][] {
  return arms
    .split("\n")
    .filter((line) => line.trim().startsWith('"~'))
    .map((line) => [...line.matchAll(/\(([a-z]+(?:\|[a-z]+)+)\)/g)].flatMap((treffer) => (treffer[1] ?? "").split("|")));
}

/** The query-parameter names the edge redacts in EVERY arm of its map. */
function redactedParameterNames(): string[] {
  const config = readFileSync(EDGE_CONFIG, "utf8");
  const block = config.slice(config.indexOf("map $request_uri $credential_free_uri {"));
  const [first, ...weitere] = armAlternations(block.slice(0, block.indexOf("}")));

  // The intersection rather than the union: the first arm keeps the path and replaces the query
  // alone, so a name only the arms below it hold costs every access line its path.

  // Empty where the map was read as having no arm at all, which the floor below reports.
  return first === undefined ? [] : first.filter((name) => weitere.every((arm) => arm.includes(name)));
}

/**
 * Fails unless `link`'s credential rides in a parameter the edge redacts, matched by name alone.
 * It lives in the tests' support folder, since the link tests of two features call it.
 */
export function assertRedactedAtTheEdge(link: string): void {
  const redacted = redactedParameterNames();
  const name = /\?(\w+)=/.exec(link)?.[1] ?? "";

  assert.ok(redacted.length > 0, "the edge's map was read as replacing no parameter at all, so this case compares nothing");
  assert.ok(redacted.includes(name), `the link is spelled \`${name}=\`, which the edge does not redact`);
}
