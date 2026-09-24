import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { publishedCeilings, readPublishedDocument } from "@/core/publishedCeilings.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

const { FormPersonSection } = await import("./FormPersonSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

/** The number the edit's own payload publishes, read rather than restated, so a moved ceiling moves the case. */
const CEILINGS = new Map(
  publishedCeilings(readPublishedDocument(), ["FLPatchSpielerPayload"]).map(({ field, characters }) => [field, characters]),
);

/** No descriptor for any path, which is the state the panel stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

const MARKUP = renderTree(
  h(DraftStatusProvider, {
    status: STATUS,
    children: h(FormPersonSection, {
      draft: { vorname: "Lena", nachname: "Meier", geburtsdatum: null },
      onChange: () => undefined,
      onFieldLeft: () => undefined,
    }),
  }),
);

/** The `maxlength` on the one input whose `name` is `field`, or `null` for a box that caps nothing. */
function capOf(field: string): number | null {
  const boxes = [...MARKUP.matchAll(/<input\b([^>]*)>/g)].map((hit) => hit[1] ?? "").filter((attrs) => attrs.includes(` name="${field}"`));

  assert.equal(boxes.length, 1, `expected one box writing ${field}, rendered ${String(boxes.length)}`);
  const cap = /\bmaxlength="(\d+)"/i.exec(boxes[0] ?? "")?.[1];

  return cap === undefined ? null : Number(cap);
}

// The box stops the keystroke the save would refuse, as every other box writing a name held to this
// ceiling does; uncapped, the administrator types past it and learns so only from the field's refusal.
describe("the pupil editor's name boxes", () => {
  for (const field of ["vorname", "nachname"] as const) {
    it(`caps ${field} at the ceiling the edit's payload publishes`, () => {
      const ceiling = CEILINGS.get(field) ?? null;

      assert.ok(ceiling !== null, `FLPatchSpielerPayload publishes no ceiling on ${field}, so this case compares nothing`);
      assert.equal(capOf(field), ceiling);
    });
  }
});
