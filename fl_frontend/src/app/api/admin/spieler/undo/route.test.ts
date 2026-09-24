import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, doubleUndoRequest, undo } from "@/shared/testing/undoRoutes.ts";

/* The real route, called: the request it runs in and the writes it replays are the doubles. */
const { answerWith, calls } = doubleUndoRequest("/src/features/spieler/mutations.ts");
const { POST } = await import("./route.ts");

/**
 * What `fl_frontend/src/features/spieler/mutations.ts :: patchSaisonSpieler` sends, as the backend's own routes spell
 * it. The person half's `PATCH /spieler/{spieler_id}` publishes no 409.
 */
const SQUAD_OPERATION = "PATCH /spieler/{spieler_id}/saisons/{saison_id}";

const SPIELER_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const PERSON = { id: SPIELER_ID, vorname: "Lena", nachname: "Meier", geburtsdatum: null };
const SAISON = {
  spieler_id: SPIELER_ID,
  saison_id: "2026",
  team_id: "6890a1b2c3d4e5f607182932",
  nummer: null,
  position: null,
  stufe: null,
  rolle: null,
};

/** The person half restored, and the squad half refused with `code`. */
function refuseTheSquadHalf(code: string): void {
  answerWith(() => {
    const call = calls.at(-1)?.action;
    return call === "patchSaisonSpieler" ? Promise.reject(refusedOn(SQUAD_OPERATION, code)) : Promise.resolve({ acknowledged: 1 });
  });
}

describe("the player save's undo", () => {
  it("replays both halves, the person first", async () => {
    calls.length = 0;
    const answer = await undo(POST, { person: PERSON, saison: SAISON });

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(
      calls.map((call) => call.action),
      ["patchSpieler", "patchSaisonSpieler"],
    );
  });

  it("words every refusal the squad half publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(SQUAD_OPERATION),
      refuse: refuseTheSquadHalf,
      press: () => undo(POST, { saison: SAISON }),
    });
  });

  /* The person half went back first, so the change does not stand whole and the answer may not say it does. */
  it("says only the person half went back where the squad half is refused after it", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(SQUAD_OPERATION),
      refuse: refuseTheSquadHalf,
      press: () => undo(POST, { person: PERSON, saison: SAISON }),
      closing: "Nur die Personendaten wurden zurückgesetzt.",
    });
  });
});
