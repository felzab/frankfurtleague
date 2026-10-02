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
});
