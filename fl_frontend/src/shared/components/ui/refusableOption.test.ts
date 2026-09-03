import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { renderMarkup } from "@/shared/testing/renderTest";

import { pickIfOffered } from "./refusableOption";

import type { RefusableOption } from "./refusableOption";

/*
 Reached after the harness above has evaluated, which is when the JSX compile step is registered: a
 static import beside it resolves first and dies on the extension.
*/
const { RefusableSelect } = await import("./RefusableSelect.tsx");

const option = (id: string, refusal: string | null): RefusableOption => ({ id, name: id.toUpperCase(), meta: null, refusal });

const OPTIONS: readonly RefusableOption[] = [option("frei", null), option("voll", "Die Gruppe ist voll"), option("auch-frei", null)];

describe("the row a refusable picker hands on", () => {
  /* The ordinary case, first: everything below is a refusal, and a `pickIfOffered` that returned
     `null` for everything would pass all of them while offering nothing at all. */
  it("hands on an offered row", () => {
    assert.equal(pickIfOffered(OPTIONS, "frei"), "frei");
    assert.equal(pickIfOffered(OPTIONS, "auch-frei"), "auch-frei");
  });

  /* The clause no panel carries itself. Widen this to a plain existence check and a
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

  /* Which function a change handler asks reaches no markup, so that wiring is read where it is
     written — and the cases above would otherwise pass over a function nobody calls. */
  it("is what the picker's own change handler asks", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "RefusableSelect.tsx"), "utf8");

    assert.match(source, /pickIfOffered\(options, key\?\.toString\(\) \?\? null\)/);
    assert.doesNotMatch(source, /options\.find\(/, "the picker looks the row up a second time");
  });
});

/** A row as a panel hands it over: the name a reader knows it by, and the count that decides the pick. */
const GRUPPE: RefusableOption = { id: "a", name: "Gruppe A", meta: "3 von 8", refusal: null };

const picker = (value: RefusableOption | null): string =>
  renderMarkup(RefusableSelect, {
    label: "Gruppe",
    placeholder: "Gruppe wählen",
    value,
    options: [GRUPPE],
    onChange: () => undefined,
    isDisabled: false,
  });

const LEER = picker(null);
const GEWAEHLT = picker(GRUPPE);

describe("what the picker says before anyone opens it", () => {
  /* Read off the prop rather than `Select.Value`, which can lag a render behind and would put
     HeroUI's English placeholder where this control spells the app's own. */
  it("names the picked row with its count, and the app's own prompt while nothing is picked", () => {
    assert.match(LEER, /<span[^>]*>Gruppe wählen<\/span>/, "the empty trigger does not read the prompt it was handed");
    assert.match(GEWAEHLT, /<span[^>]*>Gruppe A \(3 von 8\)<\/span>/, "the trigger shows something other than the picked row and its count");
    assert.ok(!GEWAEHLT.includes("Gruppe wählen"), "the prompt still stands over a row already picked");
  });

  /* HeroUI's own `Label` rather than a bare span: it wires `for`/`id` onto the trigger, which an
     `aria-label` alone leaves unlabelled for anything reading the DOM rather than the a11y tree. */
  it("labels its trigger with an element rather than a string alone", () => {
    assert.match(LEER, /data-slot="label"[^>]*>Gruppe</, "the field's label is not an element the DOM can follow");
    assert.match(LEER, /<button[^>]*\saria-labelledby="/, "the trigger names no labelling element");
  });
});
