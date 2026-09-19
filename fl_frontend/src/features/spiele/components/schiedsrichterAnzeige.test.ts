import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { GHOST_SCHIEDSRICHTER_ID, SCHIEDSRICHTER_ANONYM_LABEL, SCHIEDSRICHTER_OHNE_NAMEN_LABEL } from "@/features/schiedsrichter/constants.ts";
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
/** A row somebody left without a name, which is a person still in the league and not an erasure. */
const NAMELESS_ID = "6890a1b2c3d4e5f607800002";
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
function draftOf(name: string | null, { booked = true, id = REFEREE_ID } = {}): FLSpielWithDraftFields {
  return {
    ...A_FIXTURE,
    team1: null,
    team2: null,
    ort: null,
    schiedsrichter: booked ? { schiedsrichter_id: id, name, payment: PAYMENT } : null,
  };
}

/**
 * The referee cell alone. The whole preview is read for it because the VENUE cell beside it renders
 * the same placeholder, so a search over the markup cannot tell which of the two produced one.
 */
function refereeCell(spiel: FLSpielWithDraftFields): string {
  const rendered = textOf(renderMarkup(SpielDraftPreview, { previewSpiel: spiel, today: TODAY, isDirty: false, isFinishedSaison: false }));
  const at = rendered.indexOf("Schiedsrichter");

  assert.notEqual(at, -1, `the preview rendered no referee cell at all: ${rendered}`);

  return rendered.slice(at + "Schiedsrichter".length);
}

describe("what the draft preview renders where a fixture's referee has no name", () => {
  /* The floor under every case below: were any two of the three words equal, each would pass on
     another's value. */
  it("keeps the three absences apart", () => {
    assert.equal(new Set([SCHIEDSRICHTER_ANONYM_LABEL, SCHIEDSRICHTER_OHNE_NAMEN_LABEL, PLACEHOLDER.entity]).size, 3);
  });

  /* Three different things the cell must not confuse: an erased person, a person whose entry is
     unfinished, and no referee at all. Only the first is a deletion, and only the id says which. */
  it("tells the ghost, a nameless entry and an unbooked fixture apart", () => {
    assert.equal(refereeCell(draftOf(null, { id: GHOST_SCHIEDSRICHTER_ID })), SCHIEDSRICHTER_ANONYM_LABEL);
    assert.equal(refereeCell(draftOf(null, { id: NAMELESS_ID })), SCHIEDSRICHTER_OHNE_NAMEN_LABEL);
    assert.equal(refereeCell(draftOf(null, { booked: false })), PLACEHOLDER.entity);
  });

  it("renders an ordinary referee's own name", () => {
    assert.equal(refereeCell(draftOf("Anna Körner")), "Anna Körner");
  });
});

/** A row the admin list does serve, nameless because a hand-write left it so. */
const NAMENLOS_IN_LIST: FLSchiedsrichter = {
  id: NAMELESS_ID,
  name: null,
  schule: null,
  default_payment: PAYMENT,
  kontakt: { telefon: null, email: null },
  inactive_since: null,
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

describe("what the referee picker's trigger renders for a fixture whose referee is off the list", () => {
  /* The erasure deletes the person's row and repoints their fixtures at the ghost, which the list
     excludes by id, so a fixture that HOLDS one is built from a list offering nobody. */
  it("names the held referee by its own id even though the list offers nobody", () => {
    assert.ok(
      pickerText({ schiedsrichter_id: GHOST_SCHIEDSRICHTER_ID, name: null, payment: PAYMENT }).includes(SCHIEDSRICHTER_ANONYM_LABEL),
      "a fixture on the ghost does not read as erased",
    );

    const nameless = pickerText({ schiedsrichter_id: NAMELESS_ID, name: null, payment: PAYMENT });
    assert.ok(nameless.includes(SCHIEDSRICHTER_OHNE_NAMEN_LABEL), `the held nameless row renders no stand-in name: ${nameless}`);
    assert.ok(!nameless.includes(SCHIEDSRICHTER_ANONYM_LABEL), "a held nameless row claims an erasure that never touched it");
  });

  it("leaves the trigger empty where the fixture books nobody", () => {
    assert.ok(!pickerText(null).includes(SCHIEDSRICHTER_ANONYM_LABEL), "an unbooked fixture names an erased referee");
  });
});

describe("which word the picker's OFFERED nameless row takes", () => {
  /* The list serves no erased person and never the ghost (`docs/backend/spec.md :: I227`), so a name
     missing there is what a hand-write left and never a deletion. */
  it("offers a nameless list row under the unfinished-entry word", () => {
    const listed = pickerText(null, [NAMENLOS_IN_LIST]);

    assert.ok(listed.includes(SCHIEDSRICHTER_OHNE_NAMEN_LABEL), `the offered row renders no stand-in name: ${listed}`);
    assert.ok(!listed.includes(SCHIEDSRICHTER_ANONYM_LABEL), "an offered row claims an erasure the list never serves");
  });
});
