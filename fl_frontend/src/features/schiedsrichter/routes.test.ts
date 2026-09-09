import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const ROUTE_DIR = path.resolve(import.meta.dirname, "..", "..", "app", "admin", "schiedsrichter");
const DETAIL_PAGE = readFileSync(path.join(ROUTE_DIR, "[schiedsrichter_id]", "page.tsx"), "utf8");
const LIST_PAGE = readFileSync(path.join(ROUTE_DIR, "page.tsx"), "utf8");

/** The filters one `getSchiedsrichter(...)` call is given, or `null` where the page composes them elsewhere. */
function readTerms(page: string): string | null {
  return /getSchiedsrichter\(\{([^}]*)\}\)/.exec(page)?.[1] ?? null;
}

describe("what each referee route asks the endpoint for", () => {
  it("reads the record page with both switches, an erased referee being off the default list", () => {
    const terms = readTerms(DETAIL_PAGE);

    assert.ok(terms, "the detail page reads the referee list without filters of its own");
    // This route is where `AdminSchiedsrichterEditView` sends an erased referee, so a read leaving
    // them out answers not-found for the one page that says they were erased and on what day.
    assert.match(terms, /include_anonymisiert:\s*true/);
    assert.match(terms, /include_inactive:\s*true/);
  });

  it("composes the list page's own read from the bar rather than from a literal", () => {
    // Written twice, the switch and the pill part company: the option would be picked and the read
    // would keep answering without the rows it asks for.
    assert.equal(readTerms(LIST_PAGE), null);
    assert.match(LIST_PAGE, /getSchiedsrichterList\(params\)/);
  });
});
