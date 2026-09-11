import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { SCHIEDSRICHTER_ANONYM_LABEL, SCHIEDSRICHTER_OHNE_NAMEN_LABEL } from "@/features/schiedsrichter/constants.ts";
import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest.ts";
import { PLACEHOLDER } from "@/shared/utils/format.ts";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas.ts";
import type { FLDraftStatus } from "@/shared/utils/draftStatus.ts";
import type { FLSpiel, FLSpielWithDraftFields } from "../schemas.ts";

/* Imported after the harness registers its loader, which is what compiles a `.tsx` at all. */
const { SpielDraftPreview } = await import("./forms/AdminEditSpielDataForm/SpielDraftPreview.tsx");
const { FormSchiedsrichterSection } = await import("./forms/AdminEditSpielDataForm/FormSchiedsrichterSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { SpielExpectedProvider } = await import("./forms/AdminEditSpielDataForm/SpielExpectedContext.tsx");

/* The picker's label and its expected marker each read a context, so it renders under both providers or
   not at all. Empty is enough for both: a path neither holds a descriptor for renders no marker. */
const NO_DRAFT: FLDraftStatus<string> = { fields: [], byPath: new Map(), changed: [], invalid: [], isDirty: false };

const TODAY = "2026-04-01";
const REFEREE_ID = "6890a1b2c3d4e5f607800001";
const PAYMENT = 20;

const A_FIXTURE: FLSpiel = {
  id: "6890a1b2c3d4e5f607800011",
  spieltag_id: "6890a1b2c3d4e5f6078000a1",
  team1: null,
  team2: null,
  team1_quelle: null,
  team2_quelle: null,
  datum: "2026-03-15",
  uhrzeit: "14:00:00",
  ort: null,
  schiedsrichter: null,
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr: 1,
  sonderereignis: null,
  saison_phase: "gruppenphase",
  saison_id: "2026",
  notiz: null,
};

/** The fixture as the draft preview reads it: the admin shape, so the fee is present. */
function draftOf(name: string | null, booked: boolean = true): FLSpielWithDraftFields {
  return {
    ...A_FIXTURE,
    team1: null,
    team2: null,
    ort: null,
    schiedsrichter: booked ? { schiedsrichter_id: REFEREE_ID, name, payment: PAYMENT } : null,
  };
}

/**
 * The referee cell alone. The whole preview is read for it because the VENUE cell beside it renders
 * the same placeholder, so a search over the markup cannot tell which of the two produced one.
 */
function refereeCell(spiel: FLSpielWithDraftFields): string {
  const rendered = textOf(renderMarkup(SpielDraftPreview, { previewSpiel: spiel, today: TODAY, isDirty: false }));
  const at = rendered.indexOf("Schiedsrichter");

  assert.notEqual(at, -1, `the preview rendered no referee cell at all: ${rendered}`);

  return rendered.slice(at + "Schiedsrichter".length);
}

describe("what the draft preview renders where a referee's name was erased", () => {
  // The floor for the two cases below: were the two words equal, each would pass on the other's value.
  it("keeps the two absences apart", () => {
    assert.notEqual(SCHIEDSRICHTER_ANONYM_LABEL, PLACEHOLDER.entity);
  });

  /* The defect this replaces: `schiedsrichter?.name ?? PLACEHOLDER.entity` read the NAME through the
     booking's own optional chain, so a nulled name fell through to the no-referee placeholder. */
  it("shows the erasure's word rather than the no-referee placeholder", () => {
    const cell = refereeCell(draftOf(null));

    assert.equal(cell, SCHIEDSRICHTER_ANONYM_LABEL, "the erased referee does not read as erased");
  });

  it("still shows the placeholder where the fixture has no referee at all", () => {
    assert.equal(refereeCell(draftOf(null, false)), PLACEHOLDER.entity);
  });

  it("renders an ordinary referee's own name", () => {
    assert.equal(refereeCell(draftOf("Anna Körner")), "Anna Körner");
  });
});

/** A row the admin list does serve, nameless because a hand-write left it so. */
const NAMENLOS_IN_LIST: FLSchiedsrichter = {
  id: "6890a1b2c3d4e5f607800002",
  name: null,
  schule: null,
  default_payment: PAYMENT,
  kontakt: { telefon: null, email: null },
  inactive_since: null,
  anonymisiert_am: null,
};

/** The picker under both providers it reads, with the list offering NOBODY unless a caller names somebody. */
function pickerText(
  schiedsrichterPayload: { schiedsrichter_id: string; name: string | null; payment: number | null } | null,
  offered: FLSchiedsrichter[] = [],
): string {
  const picker = h(FormSchiedsrichterSection, {
    schiedsrichter: offered,
    schiedsrichterPayload,
    onSchiedsrichterChange: () => {},
    onValidateFields: () => {},
  });

  return textOf(
    renderTree(h(DraftStatusProvider, { status: NO_DRAFT, children: h(SpielExpectedProvider, { expected: [], children: picker }) })),
  );
}

describe("what the referee picker's trigger renders for a fixture whose referee is gone from the list", () => {
  /* The default read drops every retired row and the erasure retires the person it erases, so a
     fixture that HOLDS one is built from a list offering nobody. */
  it("names the held referee even though the list offers nobody", () => {
    assert.ok(pickerText({ schiedsrichter_id: REFEREE_ID, name: null, payment: PAYMENT }).includes(SCHIEDSRICHTER_ANONYM_LABEL));
  });

  it("leaves the trigger empty where the fixture books nobody", () => {
    assert.ok(!pickerText(null).includes(SCHIEDSRICHTER_ANONYM_LABEL), "an unbooked fixture names an erased referee");
  });
});

describe("which word the picker's two nameless arms take", () => {
  /* The list serves no stamped row (`docs/backend/spec.md :: I227`), so a name missing there is what
     a hand-write left, while a fixture's own embedded name is what the erasure nulled. */
  it("offers a nameless list row under the other word", () => {
    const gelistet = pickerText(null, [NAMENLOS_IN_LIST]);

    assert.ok(gelistet.includes(SCHIEDSRICHTER_OHNE_NAMEN_LABEL), `the offered row renders no stand-in name: ${gelistet}`);
    assert.ok(!gelistet.includes(SCHIEDSRICHTER_ANONYM_LABEL), "an offered row claims an erasure the list never serves");
  });
});
