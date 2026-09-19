import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup, textOf } from "../../../../shared/testing/renderTest.ts";

const { PlayoffsView } = await import("./PlayoffsView.tsx");

describe("the bracket's empty state", () => {
  const empty = (isFinishedSaison: boolean): string =>
    textOf(renderMarkup(PlayoffsView, { playoffsSpieltage: [], today: "2026-07-15", isFinishedSaison }), " ");

  /* A finished season's group phase is over: „noch“ and a hint waiting on it promise a draw that
     will never come. */
  it("says a finished season has no Finalrunden, and promises none", () => {
    assert.ok(empty(true).includes("Für diese Saison gibt es keine Finalrunden."), empty(true));
    assert.doesNotMatch(empty(true), /\bnoch\b|sobald/i);
  });

  it("keeps the running season's promise that the pairings are still to come", () => {
    assert.ok(empty(false).includes("Für diese Saison gibt es noch keine Finalrunden."), empty(false));
    assert.ok(empty(false).includes("sobald die Gruppenphase abgeschlossen ist"), empty(false));
  });
});
