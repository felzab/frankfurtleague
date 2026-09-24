import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { answerShown, DUPLICATE_KEY, publishedRefusals } from "@/shared/testing/publishedRefusals.ts";
import { sliceBetween } from "@/shared/testing/sourceText.ts";

import { mapSpielRefusal } from "./refusals.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

/** The one endpoint both write paths send, the dry run included, so one operation carries every refusal either can draw. */
const PATCH_OPERATION = "PATCH /spiele/{spiel_id}";

/** The rules restated, so a code retired from the endpoint fails here rather than leaving a dead arm behind. */
const PATCH_CODES = [
  "REQ-BOOKING-001",
  "REQ-CLASH-001",
  "REQ-DATE-001",
  "REQ-ELIGIBILITY-001",
  "REQ-ELIGIBILITY-002",
  "REQ-RESULT-001",
  "REQ-SPIELTAG-001",
  "REQ-SPIELTAG-002",
  "REQ-STATE-002",
  "REQ-STATE-003",
  "REQ-WIRING-001",
  "REQ-WIRING-002",
  "REQ-WIRING-003",
];

const SAVE_ACTION = sliceBetween(
  ACTIONS,
  "export async function patchAdminSpielDataAction",
  "export async function previewAdminSpielDataAction",
);
const PREVIEW_ACTION = sliceBetween(ACTIONS, "export async function previewAdminSpielDataAction", null);

describe("the match editor's refusals against the codes its endpoint publishes", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/sourceText.ts :: sliceBetween`). */
  it("cuts both write paths out of the file before reading them", () => {
    assert.ok(SAVE_ACTION.includes("patchAdminSpielData(validated.data)"), "the save's call is outside its slice");
    assert.ok(!SAVE_ACTION.includes("previewAdminSpielData("), "the save's slice runs on into the preview");
    assert.ok(PREVIEW_ACTION.includes("previewAdminSpielData(validated.data)"), "the preview's call is outside its slice");
  });

  it("finds every rule the match endpoint publishes", () => {
    assert.deepEqual(
      publishedRefusals(PATCH_OPERATION).filter((code) => code !== DUPLICATE_KEY),
      PATCH_CODES,
    );
  });

  /* Two sites answer them: the slice's own mapper, and the shared reader behind it. A code neither
     claims reaches the admin as the sentence about an equivalent entry, which is false for every rule
     published here. */
  for (const code of publishedRefusals(PATCH_OPERATION)) {
    it(`${code} reaches the admin as its own refusal`, () => {
      assert.notEqual(answerShown(PATCH_OPERATION, code, mapSpielRefusal), null, `${code} tells the admin an equivalent entry already exists`);
    });
  }

  /* The dry run draws every refusal the save does, so both consult the one mapper. */
  it("consults the mapper on the save and on the dry run", () => {
    assert.ok(SAVE_ACTION.includes("mapSpielRefusal(error)"), "the save rethrows a refusal the mapper would place");
    assert.ok(PREVIEW_ACTION.includes("mapSpielRefusal(error)"), "the dry run rethrows a refusal the mapper would place");
  });
});

describe("the match edit's refusals when the undo replays it", () => {
  const UNDO_ROUTE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin", "spiele", "undo", "route.ts"), "utf8");

  /** One row of the route's replay table, which is a literal keyed by code. */
  const replayRow = (code: string): string => new RegExp(`"${code}":\\s*"([^"]*)"`).exec(UNDO_ROUTE)?.[1] ?? "";

  it("adds the outcome sentence once, outside the rows", () => {
    assert.ok(UNDO_ROUTE.includes('const CHANGE_STANDS = "Die Änderung steht weiterhin.";'), "the whole-change outcome is gone");
    // Unconditional, which is what the one transaction buys: a refusal on any entry leaves the whole
    // change standing rather than the part a stopped replay had already put back.
    assert.ok(UNDO_ROUTE.includes("${refusal} ${CHANGE_STANDS}"), "a refusal no longer closes with the outcome");
  });

  /* The route's own rows, never the shared reader's, whose German is written for a save — one arm
     says to delete the goals the undo puts back. The duplicate key alone is the shared reader's, on
     both paths. */
  for (const code of publishedRefusals(PATCH_OPERATION).filter((published) => published !== DUPLICATE_KEY)) {
    it(`${code} reaches the admin in German when the edit is undone`, () => {
      const row = replayRow(code);

      assert.notEqual(row, "", `${code} falls through to the generic conflict message when the edit is undone`);
      // The route joins the row to the outcome with a space, so a row without its own stop runs the two sentences together.
      assert.ok(row.endsWith("."), `${code}'s replay row does not close its sentence`);
      assert.ok(!row.includes("Die Änderung steht weiterhin"), `${code}'s row states the outcome the route already adds`);
      /* One replay carries several fixtures, so a row pointing at one of them is wrong on the rest.
         Case-insensitive: every row is a sentence, and the singular a row would open with is capital. */
      assert.doesNotMatch(row, /\b(?:dieses|diesem|das)\s+Spiels?\b/i, `${code}'s row points at a single fixture the replay may not have`);
    });
  }
});
