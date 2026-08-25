import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { pickIfOffered } from "./refusableOption";

import type { RefusableOption } from "./refusableOption";

const option = (id: string, refusal: string | null): RefusableOption => ({ id, name: id.toUpperCase(), meta: null, refusal });

const OPTIONS: readonly RefusableOption[] = [option("frei", null), option("voll", "Die Gruppe ist voll"), option("auch-frei", null)];

describe("the row a refusable picker hands on", () => {
  /* The ordinary case, first: everything below is a refusal, and a `pickIfOffered` that returned
     `null` for everything would pass all of them while offering nothing at all. */
  it("hands on an offered row", () => {
    assert.equal(pickIfOffered(OPTIONS, "frei"), "frei");
    assert.equal(pickIfOffered(OPTIONS, "auch-frei"), "auch-frei");
  });

  /* The clause the panels no longer carry themselves. Widen this to a plain existence check and a
     closed row reaches a write the endpoint answers 409 — with the picker still showing it disabled,
     so nothing on the page says what happened. */
  it("refuses a row carrying a refusal, however it arrived", () => {
    assert.equal(pickIfOffered(OPTIONS, "voll"), null);
  });

  /* `refusal` holds the REASON, so any reason closes the row. A truthiness test would reopen a row
     whose reason came back empty, which is the one case a reader would never think to check. */
  it("treats null as the only offered state", () => {
    assert.equal(pickIfOffered([option("leer", "")], "leer"), null);
  });

  /* HeroUI hands the change a key of its own, and a cleared trigger hands it nothing. Neither may
     resolve to a row. */
  it("refuses a key naming no row, and a missing key", () => {
    assert.equal(pickIfOffered(OPTIONS, "kein-team"), null);
    assert.equal(pickIfOffered(OPTIONS, null), null);
    assert.equal(pickIfOffered([], "frei"), null);
  });

  /* What ties the decision above to the element making it. `RefusableSelect` is a client component
     the runner cannot render, so nothing else notices a check written back into `handleChange` — and
     the cases above would pass over a function nobody calls. */
  it("is what the picker's own change handler asks", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "RefusableSelect.tsx"), "utf8");

    assert.match(source, /pickIfOffered\(options, key\?\.toString\(\) \?\? null\)/);
    assert.doesNotMatch(source, /options\.find\(/, "the picker looks the row up a second time");
  });
});
