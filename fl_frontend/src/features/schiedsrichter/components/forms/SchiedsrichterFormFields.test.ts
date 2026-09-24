import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { widthsAgainstBoxes } from "@/shared/testing/boxCaps.ts";
import { renderMarkup } from "@/shared/testing/renderTest.ts";

const { SchiedsrichterFormFields } = await import("./SchiedsrichterFormFields.tsx");

const MARKUP = renderMarkup(SchiedsrichterFormFields, {
  draft: { name: "Anna Schmidt", default_payment: 20, kontakt: { telefon: null, email: "anna.schmidt@beispiel.de" }, schule: null },
  onChange: () => undefined,
});

// The create's own payload, which both the referee editor's create and the match form's inline create send.
const WIDTHS = widthsAgainstBoxes(MARKUP, "FLPostSchiedsrichterPayload");

// The box stops the keystroke the save would refuse, as every box writing a name held to this ceiling
// does; uncapped, the administrator types past it and learns so only from the field's refusal.
describe("the referee create's boxes against the ceilings its payload publishes", () => {
  it("finds a ceiling to judge", () => {
    assert.ok(WIDTHS.length > 0, "FLPostSchiedsrichterPayload publishes no character ceiling, so these fields compare nothing");
  });

  it("renders a box for every published ceiling", () => {
    // A ceiling on a field these fields stopped writing would otherwise pass as having nothing to cap.
    assert.deepEqual(
      WIDTHS.filter(({ caps }) => caps.length === 0).map(({ field }) => field),
      [],
    );
  });

  for (const { field, bound, caps } of WIDTHS) {
    it(`caps every box writing ${field} at ${String(bound)}`, () => {
      assert.deepEqual(
        caps,
        caps.map(() => bound),
      );
    });
  }
});
