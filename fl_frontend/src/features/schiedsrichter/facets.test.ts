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
    anonymisiert_am: null,
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

  it("adds rather than narrows where two options are picked, which is what OR within a facet promises", () => {
    assert.deepEqual(applyFacets([...SERVED], SCHIEDSRICHTER_FACETS, selection("angaben=schule,ohne_kontakt")), [MIT_SCHULE, OHNE_ALLES]);
  });
});
