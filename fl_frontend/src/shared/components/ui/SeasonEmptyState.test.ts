import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { renderMarkup, textOf } from "@/shared/testing/renderTest";

const { SeasonEmptyState } = await import("./SeasonEmptyState.tsx");

const SRC = path.resolve(import.meta.dirname, "..", "..", "..");
const RECIPE = path.join(SRC, "shared", "components", "ui", "SeasonEmptyState.tsx");

/** The frame every one of these sentences is built on, which is what a copy would spell again. */
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

  /* Six views wrote this sentence for themselves, and two of them drifted to „sind noch keine …
     eingetragen“ — one frame two ways, on pages a reader meets in the same session. */
  it("is the only place an empty state spells the sentence", () => {
    // Inside an `EmptyState` alone: a refusal and a not-found title open on the same words without
    // being this sentence, and a sweep over the frame reports both.
    const spellings = filesUnder(SRC, (name) => /\.tsx?$/.test(name) && !isTestFile(name), 400)
      .filter((file) => {
        const text = readFileSync(file, "utf8");
        return file !== RECIPE && text.includes(FRAME) && text.includes("<EmptyState");
      })
      .map((file) => path.relative(SRC, file).split(path.sep).join("/"));

    assert.deepEqual(spellings, [], `these spell the season's empty sentence inline:\n  ${spellings.join("\n  ")}`);
  });
});
