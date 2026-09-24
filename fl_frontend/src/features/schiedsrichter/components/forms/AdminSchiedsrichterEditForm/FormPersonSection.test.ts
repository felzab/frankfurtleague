import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { widthsAgainstBoxes } from "@/shared/testing/boxCaps.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

const { FormPersonSection } = await import("./FormPersonSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

/** No descriptor for any path, which is the state the panel stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

const MARKUP = renderTree(
  h(DraftStatusProvider, {
    status: STATUS,
    children: h(FormPersonSection, {
      name: "Anna Schmidt",
      onNameChange: () => undefined,
      schule: null,
      onSchuleChange: () => undefined,
      onFieldLeft: () => undefined,
    }),
  }),
);

// Read off the edit's own payload rather than listed, so a ceiling it publishes later is judged here too.
const WIDTHS = widthsAgainstBoxes(MARKUP, "FLPatchSchiedsrichterPayload");

// The box stops the keystroke the save would refuse, as every box writing a name held to this ceiling
// does; uncapped, the administrator types past it and learns so only from the field's refusal.
describe("the referee editor's person boxes against the ceilings its payload publishes", () => {
  it("finds a ceiling to judge", () => {
    assert.ok(WIDTHS.length > 0, "FLPatchSchiedsrichterPayload publishes no character ceiling, so this section compares nothing");
  });

  it("renders a box for every published ceiling", () => {
    // A ceiling on a field this section stopped writing would otherwise pass as having nothing to cap.
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
