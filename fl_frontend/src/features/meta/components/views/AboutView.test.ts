import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup, textOf } from "@/shared/testing/renderTest";

const { AboutView } = await import("./AboutView.tsx");

const SEITE = textOf(renderMarkup(AboutView, {}), " ").replace(/\s+/g, " ").trim();

describe("the About page's aim", () => {
  /* Spelled out rather than read off the view: the Q&A's financing answer says both teams of a match share its
     takings, and a sentence crediting the host's year group alone contradicts it on the same page. */
  it("credits a match's takings to both year groups", () => {
    assert.ok(
      SEITE.includes("Jedes Spiel bringt durch Ticket- und Cateringverkäufe direkte Einnahmen für beide Jahrgänge."),
      "the aim no longer says both year groups share a match's takings",
    );
  });
});
