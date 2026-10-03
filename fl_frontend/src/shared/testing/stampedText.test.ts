import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { filledSlots } from "./stampedText.ts";

describe("a stamped sentence filled for a comparison", () => {
  it("fills every slot it holds a value for and leaves the rest standing", () => {
    assert.equal(
      filledSlots("{rolle} für {schule}, {rolle}", { schule: "Lessing-Kolleg", rolle: "Trainer" }),
      "Trainer für Lessing-Kolleg, Trainer",
    );
    assert.equal(filledSlots("{rolle} für {schule}", { schule: "Lessing-Kolleg" }), "{rolle} für Lessing-Kolleg");
  });

  it("fills the privacy slot whatever the map names, as the page links it", () => {
    assert.equal(filledSlots("in der {datenschutz}", {}), "in der Datenschutzerklärung");
    assert.equal(filledSlots("in der {datenschutz}", { datenschutz: "etwas anderes" }), "in der Datenschutzerklärung");
  });

  /* A record read answers `Object.prototype`'s members: read as values, these would fill a sentence
     with a function's source, and the page with a hole. */
  it("leaves a slot standing that only the prototype names", () => {
    assert.equal(filledSlots("{constructor} {toString} {__proto__}", {}), "{constructor} {toString} {__proto__}");
  });
});
