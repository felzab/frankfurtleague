import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup, textOf } from "@/shared/testing/renderTest.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { Gefuellt } = await import("./BestaetigungPanels.tsx");

describe("a stamped sentence with its slots filled", () => {
  it("leaves a slot no record filled standing", () => {
    const html = renderMarkup(Gefuellt, { text: "{rolle} für {schule}", werte: { schule: "Lessing-Kolleg" }, eigene: new Set<string>() });

    assert.equal(textOf(html), "{rolle} für Lessing-Kolleg");
  });
});
