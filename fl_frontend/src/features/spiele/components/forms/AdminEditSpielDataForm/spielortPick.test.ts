import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { FLSpielOrtFieldDraft } from "@/features/spiele/schemas.ts";
import type { FLDraftStatus } from "@/shared/utils/draftStatus.ts";

/* Imported after the harness registers its loader, which is what compiles a `.tsx` at all. */
const { FormSpielortSection } = await import("./FormSpielortSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { SpielExpectedProvider } = await import("./SpielExpectedContext.tsx");

/* The picker's label and its expected marker each read a context, so it renders under both providers or
   not at all. Empty is enough for both: a path neither holds a descriptor for renders no marker. */
const NO_DRAFT: FLDraftStatus<string> = { fields: [], byPath: new Map(), changed: [], invalid: [], isDirty: false };

const VENUE_ID = "6890a1b2c3d4e5f607800021";
/** Not the placeholder's own example venue, which the trigger renders while nothing is picked. */
const VENUE_NAME = "Turnhalle Riedberg";

const BOOKED: FLSpielOrtFieldDraft = {
  spielort_id: VENUE_ID,
  name: VENUE_NAME,
  maps_link: `${VENUE_NAME}, Musterweg 1, 60311 Frankfurt am Main, Deutschland`,
  mietpreis: 40,
};

/** The picker under both providers it reads, with the list offering NOTHING. */
function pickerText(ortPayload: FLSpielOrtFieldDraft | null): string {
  const picker = h(FormSpielortSection, {
    spielorte: [],
    ortPayload,
    onOrtChange: () => {},
    onValidateFields: () => {},
  });

  return textOf(
    renderTree(h(DraftStatusProvider, { status: NO_DRAFT, children: h(SpielExpectedProvider, { expected: [], children: picker }) })),
  );
}

describe("what the venue picker's trigger renders for a fixture whose venue is gone from the list", () => {
  /* `getSpielorte()`'s default read drops every row carrying `inactive_since`, so a fixture that
     already books a retired venue is built from a list offering nothing. */
  it("names the held venue even though the list offers none", () => {
    assert.ok(pickerText(BOOKED).includes(VENUE_NAME), "the trigger renders no venue on a fixture that has one");
  });

  it("leaves the trigger empty where the fixture books no venue", () => {
    assert.ok(!pickerText(null).includes(VENUE_NAME), "an unbooked fixture names a venue");
  });
});
