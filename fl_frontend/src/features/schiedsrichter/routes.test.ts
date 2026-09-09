import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/* Read as source: each route's fetch sits in an async Server Component behind a `Suspense`
   boundary, and the harness renders synchronously — it commits the fallback, never enters that
   component, and issues no read for a case to observe. */
const ROUTE_DIR = path.resolve(import.meta.dirname, "..", "..", "app", "admin", "schiedsrichter");
const DETAIL_PAGE = readFileSync(path.join(ROUTE_DIR, "[schiedsrichter_id]", "page.tsx"), "utf8");
const LIST_PAGE = readFileSync(path.join(ROUTE_DIR, "page.tsx"), "utf8");

describe("what each referee route asks the endpoint for", () => {
  it("reads the record page by id, an erased referee being off every list", () => {
    // This route is where a fixture's referee link lands and where `AdminSchiedsrichterEditView`
    // sends an erased referee, so a read served from the referee list answers not-found for both.
    assert.match(DETAIL_PAGE, /getSchiedsrichterById\(schiedsrichterId\)/);
    assert.doesNotMatch(DETAIL_PAGE, /getSchiedsrichter\(/);
  });

  it("asks the list page's own read for the retired, whom this list is the only surface that can bring back", () => {
    assert.match(LIST_PAGE, /getSchiedsrichter\(\{\s*include_inactive:\s*true\s*\}\)/);
  });
});
