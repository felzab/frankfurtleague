import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/* The subject is a wiring between two modules: which query each route file calls. The list is
   narrowed and the by-id read is not, so a route on the wrong one answers not-found for a row that
   exists. */
const ROUTE_DIR = path.resolve(import.meta.dirname, "..", "..", "app", "admin", "schiedsrichter");
const DETAIL_PAGE = readFileSync(path.join(ROUTE_DIR, "[schiedsrichter_id]", "page.tsx"), "utf8");
const LIST_PAGE = readFileSync(path.join(ROUTE_DIR, "page.tsx"), "utf8");

describe("what each referee route asks the endpoint for", () => {
  it("reads the record page by id, the list being narrowed", () => {
    // The list drops the ghost and every row a filter excludes, so a detail page served from it would
    // answer not-found for a referee whose editor this route is the only way into.
    assert.match(DETAIL_PAGE, /getSchiedsrichterById\(schiedsrichterId\)/);
    assert.doesNotMatch(DETAIL_PAGE, /getSchiedsrichter\(/);
  });

  it("asks the list page's own read for the retired, whose row here is the only link into their editor", () => {
    assert.match(LIST_PAGE, /getSchiedsrichter\(\{\s*include_inactive:\s*true\s*\}\)/);
  });
});
