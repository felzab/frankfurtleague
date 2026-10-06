import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { schiedsrichterKonto, schiedsrichterSelbst, spielerKonto, spielerSelbst } from "./selbstFixtures.ts";

/* Reached with `await import`, for `fixtures.test.ts`'s reason: a module under `shared` may not name a slice. */
const { FLSpielerSelbstSchema } = await import("@/features/spieler/schemas.ts");
const { FLSchiedsrichterSelbstSchema } = await import("@/features/schiedsrichter/schemas.ts");
const { FLKontoSchiedsrichterEinwilligungSchema, FLKontoSpielerEinwilligungSchema } = await import("@/features/konto/schemas.ts");

describe("the own-data reads and account entries every suite rendering one starts from", () => {
  for (const [lesung, fixture, schema] of [
    ["the pupil's own read", spielerSelbst, FLSpielerSelbstSchema],
    ["the referee's own read", schiedsrichterSelbst, FLSchiedsrichterSelbstSchema],
    ["the pupil's account entry", spielerKonto, FLKontoSpielerEinwilligungSchema],
    ["the referee's account entry", schiedsrichterKonto, FLKontoSchiedsrichterEinwilligungSchema],
  ] as const) {
    /* Both directions, because zod strips an unknown key in silence: a field renamed on the mirror
       would leave the fixture spelling the old name and the parse filling neither. */
    it(`spells exactly the fields ${lesung} mirror declares, and parses`, () => {
      assert.deepEqual(Object.keys(fixture()).sort(), Object.keys(schema.shape).sort());
      assert.doesNotThrow(() => schema.parse(fixture()));
    });
  }

  it("hands each suite its own copy, so a case's change never reaches the next case", () => {
    assert.notEqual(spielerKonto(), spielerKonto());
    assert.notEqual(schiedsrichterKonto().kontakt, schiedsrichterKonto().kontakt);
  });
});
