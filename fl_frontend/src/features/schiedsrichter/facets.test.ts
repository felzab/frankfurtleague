import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyFacets, countFacetOptions, readFacetSelection } from "@/shared/utils/facets.ts";

import { SCHIEDSRICHTER_ANGABEN_PARAM, SCHIEDSRICHTER_FACETS, schiedsrichterFacetCounts, schiedsrichterListTerms } from "./facets.ts";

import type { FLSchiedsrichter } from "./schemas.ts";

/** The facet under test, cut out by its parameter. */
const ANGABEN_FACET = SCHIEDSRICHTER_FACETS.find((facet) => facet.param === SCHIEDSRICHTER_ANGABEN_PARAM);

function referee(id: string, held: Partial<FLSchiedsrichter> = {}): FLSchiedsrichter {
  return {
    id: id,
    name: "Anna Körner",
    schule: null,
    default_payment: 20,
    kontakt: { telefon: null, email: null },
    inactive_since: null,
    anonymisiert_am: null,
    ...held,
  };
}

/** What the endpoint serves by default: the erased are not among them, which is the whole difficulty. */
const SERVED = [
  referee("6890a1b2c3d4e5f607910011", { kontakt: { telefon: "+49 69 1234567", email: null } }),
  referee("6890a1b2c3d4e5f607910012", { kontakt: { telefon: "+49 69 2223334", email: null }, schule: "Carl-Schurz-Schule" }),
];

/** The row the default read leaves out, for the case that widens back to it. */
const ERASED = referee("6890a1b2c3d4e5f607910013", { name: null, anonymisiert_am: "2026-04-01", inactive_since: "2026-04-01" });

/** What the endpoint answers beside those rows: the two erased referees counted while neither is served. */
const ANZAHL_JE_ANGABE: Record<string, number> = { kontakt: 2, ohne_kontakt: 1, schule: 1, geloescht: 2 };

// Registered before the component is loaded, so `renderTest.ts`'s hooks are in place: JSX compiles
// nowhere else, and `renderMarkup` beside a static import of a `.tsx` would fail to load it.
const { renderMarkup } = await import("@/shared/testing/renderTest.ts");
const { FilterPanelBody } = await import("@/shared/components/ui/FilterPanel.tsx");

/** Every option's own row, keyed by its value: the opening tag carries the key, the rest carries what it reads as. */
function rows(markup: string): Map<string, string> {
  const cut = markup.split('data-slot="list-box-item"').slice(1);

  return new Map(cut.map((item) => [/data-key="([^"]+)"/.exec(item.split(">")[0] ?? "")?.[1] ?? "", item]));
}

/** The option values a reader can still press, read off the opening tag react-aria writes them on. */
function pressable(markup: string): string[] {
  return [...rows(markup)].filter(([, item]) => !(item.split(">")[0] ?? "").includes('aria-disabled="true"')).map(([value]) => value);
}

const OPENING = readFacetSelection(SCHIEDSRICHTER_FACETS, new URLSearchParams());

/* Rendered rather than reasoned about: `isDisabled` is decided inside `FacetCell`, and what a reader
   can press is the only form of that decision anyone meets. */
function bar(counts: Record<string, number> | undefined): string {
  return renderMarkup(FilterPanelBody<FLSchiedsrichter>, {
    facets: SCHIEDSRICHTER_FACETS,
    shown: ANGABEN_FACET === undefined ? [] : [ANGABEN_FACET],
    items: [...SERVED],
    facetCounts: counts === undefined ? undefined : schiedsrichterFacetCounts({ anzahl_je_angabe: counts }),
    selection: OPENING,
    onSelect: () => undefined,
    onClear: () => undefined,
  });
}

describe("the erasure as an option of the referee list's Angaben facet", () => {
  /* First: every assertion below reads `undefined` where the cut above finds no facet. */
  it("offers it at all, and marks the facet as one the read narrows on", () => {
    assert.ok(ANGABEN_FACET, "no facet reads the Angaben parameter");
    // Without the mark `useUrlFilters` writes history alone, so picking it would filter the rows
    // already loaded rather than asking the server for the ones it left out.
    assert.equal(ANGABEN_FACET.narrowsTheRead, true);
    assert.deepEqual(
      ANGABEN_FACET.options.map((option) => option.label),
      ["Mit Kontakt", "Ohne Kontakt", "Mit Schule", "Daten gelöscht"],
    );
  });

  it("keeps it pressable while the page holds no erased row, and says how many there are", () => {
    const row = rows(bar(ANZAHL_JE_ANGABE)).get("geloescht");

    assert.ok(pressable(bar(ANZAHL_JE_ANGABE)).includes("geloescht"), "the way back to the erased is offered and inert");
    assert.match(row ?? "", />2</, "the option carries a number the served rows cannot answer");
  });

  /* Non-vacuity, and the defect itself: counted over what one read served, the option leading to the
     rows that read excluded is the one option guaranteed to read zero. */
  it("goes dead where the counts are taken over the rows served instead", () => {
    assert.equal(countFacetOptions([...SERVED], SCHIEDSRICHTER_FACETS, OPENING, ANGABEN_FACET!).geloescht, 0);

    assert.ok(!pressable(bar(undefined)).includes("geloescht"), "an option nothing counted was offered anyway");
  });

  it("leaves it unpressable where the collection really holds none", () => {
    assert.ok(!pressable(bar({ ...ANZAHL_JE_ANGABE, geloescht: 0 })).includes("geloescht"));
  });
});

describe("what the referee list asks the endpoint for", () => {
  const widens = (search: string): boolean =>
    schiedsrichterListTerms(search === "" ? {} : { [SCHIEDSRICHTER_ANGABEN_PARAM]: search }).include_anonymisiert === true;

  it("leaves the erased out until somebody asks for them", () => {
    assert.equal(widens(""), false);
    assert.equal(widens("kontakt"), false);
  });

  it("asks for them on that option alone, and on it beside any other", () => {
    assert.equal(widens("geloescht"), true);
    // The pairing is what makes this a widening rather than a filter: narrowing instead, the second
    // option would take the erased back out of a selection that names them.
    assert.equal(widens("kontakt,geloescht"), true);
  });

  it("still asks for the retired, whom this list is the only surface that can bring back", () => {
    assert.equal(schiedsrichterListTerms({}).include_inactive, true);
  });
});

describe("what a second option picked beside the erasure leaves", () => {
  const both = readFacetSelection(SCHIEDSRICHTER_FACETS, new URLSearchParams(`${SCHIEDSRICHTER_ANGABEN_PARAM}=kontakt,geloescht`));
  const alone = readFacetSelection(SCHIEDSRICHTER_FACETS, new URLSearchParams(`${SCHIEDSRICHTER_ANGABEN_PARAM}=geloescht`));

  /* The widened answer, which is what the endpoint serves once `geloescht` is in the selection. */
  const WIDENED = [...SERVED, ERASED];

  it("adds rows rather than taking them away", () => {
    assert.deepEqual(applyFacets([...WIDENED], SCHIEDSRICHTER_FACETS, alone), [ERASED]);
    assert.deepEqual(applyFacets([...WIDENED], SCHIEDSRICHTER_FACETS, both), WIDENED);
  });

  it("holds the erased to their own option, an emptied contact block being no answer for `Ohne Kontakt`", () => {
    const ohneKontakt = readFacetSelection(SCHIEDSRICHTER_FACETS, new URLSearchParams(`${SCHIEDSRICHTER_ANGABEN_PARAM}=ohne_kontakt`));

    // The erased row matches the option over the rows on hand; what keeps it off that list is the
    // read, which widens for `geloescht` and for nothing else.
    assert.deepEqual(applyFacets([...WIDENED], SCHIEDSRICHTER_FACETS, ohneKontakt), [ERASED]);
    assert.equal(schiedsrichterListTerms({ [SCHIEDSRICHTER_ANGABEN_PARAM]: "ohne_kontakt" }).include_anonymisiert, false);
  });
});
