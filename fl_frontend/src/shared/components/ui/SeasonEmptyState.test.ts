import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { renderMarkup, textOf } from "@/shared/testing/renderTest";

const { SeasonEmptyState } = await import("./SeasonEmptyState.tsx");

const FRAME = "Für diese Saison gibt es";

const shown = (isFinishedSaison: boolean): string =>
  textOf(renderMarkup(SeasonEmptyState, { nothing: "keinen Spielplan", hint: "Sobald die Spieltage feststehen.", isFinishedSaison }), " ")
    .replace(/\s+/g, " ")
    .trim();

describe("the empty state of a season-scoped collection", () => {
  /* „noch“ and the hint both promise something still to come, and a finished season promises
     nothing: the pair goes together or the sentence contradicts the hint under it. */
  it("drops the „noch“ and the hint once the season is finished", () => {
    assert.equal(shown(true), `${FRAME} keinen Spielplan.`);
    assert.equal(shown(false), `${FRAME} noch keinen Spielplan. Sobald die Spieltage feststehen.`);
  });
});
