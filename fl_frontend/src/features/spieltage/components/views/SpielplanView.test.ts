import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup, textOf } from "../../../../shared/testing/renderTest.ts";

const { SpielplanView } = await import("./SpielplanView.tsx");

describe("the Spielplan's empty state", () => {
  const empty = (isFinishedSaison: boolean): string =>
    textOf(renderMarkup(SpielplanView, { spielplanData: { spieltage: [] }, today: "2026-07-15", isFinishedSaison }), " ");

  /* A finished season's Spielplan is not still to come, so a „noch“ or a hint waiting on the Spieltage
     tells a reader of a past season to come back for fixtures that were never drawn. */
  it("says a finished season has no Spielplan, and promises none", () => {
    assert.ok(empty(true).includes("Für diese Saison gibt es keinen Spielplan."), empty(true));
    assert.doesNotMatch(empty(true), /\bnoch\b|sobald/i);
  });

  it("keeps the running season's promise that the Spieltage are still to come", () => {
    assert.ok(empty(false).includes("Für diese Saison gibt es noch keinen Spielplan."), empty(false));
    assert.ok(empty(false).includes("Sobald die Spieltage feststehen"), empty(false));
  });
});
