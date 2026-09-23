import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { applyFacets, countFacetOptions, readFacetSelection } from "@/shared/utils/facets.ts";

import { SCHIEDSRICHTER_FACETS } from "./facets.ts";

import type { FLSchiedsrichter } from "./schemas.ts";

/** The facet under test, cut out by the parameter it reads. */
const ANGABEN_FACET = SCHIEDSRICHTER_FACETS.find((facet) => facet.param === "angaben");

function referee(id: string, held: Partial<FLSchiedsrichter> = {}): FLSchiedsrichter {
  return {
    id: id,
    name: "Anna Körner",
    schule: null,
    default_payment: 20,
    kontakt: { telefon: null, email: null },
    inactive_since: null,
    geburtsdatum: null,
    einwilligung: null,
    bestaetigung: null,
    ...held,
  };
}

const MIT_TELEFON = referee("6890a1b2c3d4e5f607910011", { kontakt: { telefon: "+49 69 1234567", email: null } });
const MIT_SCHULE = referee("6890a1b2c3d4e5f607910012", { kontakt: { telefon: null, email: "a@example.com" }, schule: "Carl-Schurz-Schule" });
const OHNE_ALLES = referee("6890a1b2c3d4e5f607910013");

const SERVED = [MIT_TELEFON, MIT_SCHULE, OHNE_ALLES];

const selection = (search: string) => readFacetSelection(SCHIEDSRICHTER_FACETS, new URLSearchParams(search));

describe("the Angaben facet of the referee list", () => {
  /* First: every assertion below reads `undefined` where the cut above finds no facet. */
  it("offers a contact split and a school, and counts them off the rows the page holds", () => {
    assert.ok(ANGABEN_FACET, "no facet reads the Angaben parameter");
    assert.deepEqual(
      ANGABEN_FACET.options.map((option) => option.label),
      ["Mit Kontakt", "Ohne Kontakt", "Mit Schule"],
    );
    // The counts come off the served rows, so a facet whose options the endpoint cannot answer for
    // would offer every one of them at zero and disable the lot.
    assert.deepEqual(countFacetOptions([...SERVED], SCHIEDSRICHTER_FACETS, selection(""), ANGABEN_FACET), {
      kontakt: 2,
      ohne_kontakt: 1,
      schule: 1,
    });
  });

  it("reads a referee with neither a phone number nor an email address as a real gap rather than as a missing row", () => {
    assert.deepEqual(applyFacets([...SERVED], SCHIEDSRICHTER_FACETS, selection("angaben=ohne_kontakt")), [OHNE_ALLES]);
    assert.deepEqual(applyFacets([...SERVED], SCHIEDSRICHTER_FACETS, selection("angaben=kontakt")), [MIT_TELEFON, MIT_SCHULE]);
  });

  /* The placeholder a row without an address holds is the row still owed a real one, so filing it
     under „Mit Kontakt“ hides it from exactly the filter that finds it. */
  it("files a row holding only the placeholder address under „Ohne Kontakt“", () => {
    const PLATZHALTER = referee("6890a1b2c3d4e5f607910014", { kontakt: { telefon: null, email: "adresse-fehlt@frankfurtleague.invalid" } });

    assert.deepEqual(applyFacets([PLATZHALTER, MIT_TELEFON], SCHIEDSRICHTER_FACETS, selection("angaben=ohne_kontakt")), [PLATZHALTER]);
  });

  /* A row stored before the address rule holds a real address no payload takes now: filed under
     „Ohne Kontakt“, the filter reports a gap where the repair is replacing what is held. */
  it("files a row whose address predates the address rule under „Mit Kontakt“", () => {
    const VOR_DER_REGEL = referee("6890a1b2c3d4e5f607910015", { kontakt: { telefon: null, email: "jürgen@schule.de" } });

    assert.deepEqual(applyFacets([VOR_DER_REGEL, OHNE_ALLES], SCHIEDSRICHTER_FACETS, selection("angaben=kontakt")), [VOR_DER_REGEL]);
  });

  it("adds rather than narrows where two options are picked, which is what OR within a facet promises", () => {
    assert.deepEqual(applyFacets([...SERVED], SCHIEDSRICHTER_FACETS, selection("angaben=schule,ohne_kontakt")), [MIT_SCHULE, OHNE_ALLES]);
  });
});
