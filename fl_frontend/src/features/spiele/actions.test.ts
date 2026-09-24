import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, publishedRefusals } from "@/shared/testing/publishedRefusals.ts";

import { mapSpielRefusal } from "./refusals.ts";

/* The real actions, called: the request they run in and the writes they send are the doubles. */
doubleActionRequest();
const { answerWith } = doubleActions({ modules: ["/src/features/spiele/mutations.ts"] });
const { patchAdminSpielDataAction, previewAdminSpielDataAction } = await import("./actions.ts");

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

/** A fixture edit the schema takes as it stands, every field cleared, so each write reaches the doubled request. */
const EDIT = {
  datum: null,
  uhrzeit: null,
  ort: null,
  schiedsrichter: null,
  team1: null,
  team2: null,
  team1_quelle: null,
  team2_quelle: null,
  elfmeterschiessen: null,
  notiz: null,
  spiel_id: "6890a1b2c3d4e5f607182930",
  sonderereignis: null,
};

describe("the match editor's refusals against the codes its endpoint publishes", () => {
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

  /* The dry run draws every refusal the save does, so both answer through the one mapper. */
  it("answers every refusal on the save and on the dry run through the mapper", async () => {
    await assertEachAnswered({
      operation: PATCH_OPERATION,
      codes: publishedRefusals(PATCH_OPERATION),
      refuseWith: answerWith,
      act: () => patchAdminSpielDataAction(EDIT, "2026"),
      mapped: mapSpielRefusal,
    });
    await assertEachAnswered({
      operation: PATCH_OPERATION,
      codes: publishedRefusals(PATCH_OPERATION),
      refuseWith: answerWith,
      act: () => previewAdminSpielDataAction(EDIT),
      mapped: mapSpielRefusal,
      readOnly: true,
    });
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
