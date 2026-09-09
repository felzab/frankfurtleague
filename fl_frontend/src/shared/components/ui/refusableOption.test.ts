import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { renderMarkup } from "@/shared/testing/renderTest";

import { listboxRow, pickIfOffered } from "./refusableOption";

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

// Three levels up: this file sits at `src/shared/components/ui`, and a sweep rooted any lower reports
// a clean tree while a feature spells its own picker rows.
const SRC = path.resolve(import.meta.dirname, "..", "..", "..");

/* Test files are OUT: this file spells both markers below as literals, and a sweep reading itself
   would take its own fixtures for the tree's (`.claude/rules/frontend.md`). */
const isProduction = (name: string): boolean => name.endsWith(".tsx") && !isTestFile(name);

/** Every component in the tree, each read once for both of the routes below. */
const COMPONENTS: readonly (readonly [string, string])[] = filesUnder(SRC, isProduction, 200).map(
  (file) => [path.relative(SRC, file).split(path.sep).join("/"), readFileSync(file, "utf8")] as const,
);

/**
 * The popover a picker's rows sit in, never the recipe it draws them from: a population read off
 * `listboxRow` could not fail (`docs/_standard/standard.md` PRE-4).
 */
const PICKER_POPOVER = "<Select.Popover";

/**
 * A filter surface marks the current row IN its list, its trigger being an icon or a chip that
 * cannot; a picker's trigger carries the value instead, so a picker row draws no selected state
 * (`fl_frontend/src/shared/components/ui/pickedOption.ts :: PICKED_OPTION`).
 */
const FILTER_ROW = "PICKED_OPTION";

const PICKERS = COMPONENTS.filter(([, source]) => source.includes(PICKER_POPOVER) && !source.includes(FILTER_ROW));

/** The two fragments a hand-spelled row and a hand-spelled note each open with. */
const OWN_ROW = "data-hovered:bg-hover data-hovered:text-brand";
const OWN_NOTE = "fluid-xs text-foreground-muted";

describe("the row every picker's list is drawn with", () => {
  /* The floor under the reads below. `Select.Popover` draws nothing until it opens — the option text
     in the markup is react-aria's hidden native mirror, which carries no class of the row's. */
  it("puts no drawn row in the markup before the popover opens", () => {
    assert.ok(!LEER.includes(listboxRow().row()), "the row's own class reaches the markup now, so a render can assert it");
  });

  /* A marker that stopped matching would pass over every picker in silence, and the equality below
     would then compare two empty lists. Floored under the count, so retiring a picker costs nothing. */
  it("finds the pickers in the tree at all", () => {
    assert.ok(PICKERS.length >= 8, `${String(PICKERS.length)} pickers found, so this sweep is reading almost nothing`);
  });

  /* One place decides what a row looks like and what its note reads as. Spell either at a call site
     and that picker alone drifts — a duration literal beside the motion scale is the drift that shows. */
  it("is taken from this module by every picker, none of them spelling one", () => {
    const findings = PICKERS.filter(
      ([, source]) => !source.includes("listboxRow(") || source.includes(OWN_ROW) || source.includes(OWN_NOTE),
    ).map(([file]) => file);

    assert.deepEqual(findings, [], `these draw a picker's rows some other way:\n  ${findings.join("\n  ")}`);
  });

  /* The recipe reached the other way, so neither listing can shrink quietly: a combobox's compact list
     taking the picker row is as much a drift as a picker spelling its own. */
  it("is reached from those pickers and from nowhere else in the tree", () => {
    const drawing = COMPONENTS.filter(([, source]) => source.includes("listboxRow(")).map(([file]) => file);

    assert.deepEqual(
      drawing,
      PICKERS.map(([file]) => file),
      "a picker draws its rows some other way, or something that is not one draws them from here",
    );
  });

  /* The variant is the row's content, so each one has to reach a different class: collapse two and a
     label-only row reserves the space a note would have stood in. */
  it("parts a label-only row from an adorned one and from a noted one", () => {
    const spellings = new Set([listboxRow({ layout: "plain" }).row(), listboxRow({ layout: "adorned" }).row(), listboxRow().row()]);

    assert.equal(spellings.size, 3, "two of the three layouts draw the same row");
  });
});
