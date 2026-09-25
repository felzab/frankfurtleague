import assert from "node:assert/strict";
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
     claims reaches the admin as the fallback's bare retry, which names no rule and meets it again. */
  for (const code of publishedRefusals(PATCH_OPERATION)) {
    it(`${code} reaches the admin as its own refusal`, () => {
      assert.notEqual(answerShown(PATCH_OPERATION, code, mapSpielRefusal), null, `${code} reaches the admin with no reason`);
    });
  }

  /* The dry run draws every refusal the save does, so both answer through the one mapper. */
  it("answers every refusal on the save and on the dry run through the mapper", async () => {
    await assertEachAnswered({
      operation: PATCH_OPERATION,
      refuseWith: answerWith,
      act: () => patchAdminSpielDataAction(EDIT, "2026"),
      mapped: mapSpielRefusal,
    });
    await assertEachAnswered({
      operation: PATCH_OPERATION,
      refuseWith: answerWith,
      act: () => previewAdminSpielDataAction(EDIT),
      mapped: mapSpielRefusal,
      readOnly: true,
    });
  });
});
