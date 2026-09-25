import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, doubleUndoRequest, unacknowledged, undo } from "@/shared/testing/undoRoutes.ts";

/* The real route, called: the request it runs in and the writes it replays are the doubles. */
const { answerWith, calls } = doubleUndoRequest("/src/features/teams/mutations.ts");
const { POST } = await import("./route.ts");

/** What `fl_frontend/src/features/teams/mutations.ts :: patchTeam` sends, as the backend's own routes spell it. */
const CLUB_OPERATION = "PATCH /teams/{team_id}";
/** What `fl_frontend/src/features/teams/mutations.ts :: patchSaisonTeam` sends. */
const JUNCTION_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}";

const TEAM_ID = "6890a1b2c3d4e5f607182932";
const CLUB = {
  id: TEAM_ID,
  name: "SG Alpha",
  shorthand: "SA",
  description: "",
  full_name: "Sportgemeinschaft Alpha",
  website_url: null,
  address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
  schulform: null,
};
const SAISON = { team_id: TEAM_ID, saison_id: "2026", gruppe: "A", austritt: null, trikot_farbe: null };

/** `action` refused with `code` as `operation` raises it, every other write restored. */
function refuse(action: "patchTeam" | "patchSaisonTeam", operation: string, code: string): void {
  answerWith(() => (calls.at(-1)?.action === action ? Promise.reject(refusedOn(operation, code)) : Promise.resolve({ acknowledged: 1 })));
}

describe("the team save's undo", () => {
  it("replays both halves, the club first", async () => {
    calls.length = 0;
    const answer = await undo(POST, { club: CLUB, saison: SAISON });

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(
      calls.map((call) => call.action),
      ["patchTeam", "patchSaisonTeam"],
    );
  });

  it("words every refusal the club half publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(CLUB_OPERATION),
      refuse: (code) => refuse("patchTeam", CLUB_OPERATION, code),
      press: () => undo(POST, { club: CLUB, saison: SAISON }),
    });
  });

  it("words every refusal the junction half publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(JUNCTION_OPERATION),
      refuse: (code) => refuse("patchSaisonTeam", JUNCTION_OPERATION, code),
      press: () => undo(POST, { saison: SAISON }),
    });
  });

  /* The club half went back first, so the change does not stand whole and the answer may not say it does. */
  it("says only the club half went back where the junction is refused after it", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(JUNCTION_OPERATION),
      refuse: (code) => refuse("patchSaisonTeam", JUNCTION_OPERATION, code),
      press: () => undo(POST, { club: CLUB, saison: SAISON }),
      closing: "Nur die Stammdaten wurden zurückgesetzt.",
    });
  });

  /* Unacknowledged, a write may still have landed, so each arm is titled unclear and never says the
     change stands; the junction's sentence says whether the club half went back. */
  it("answers an unacknowledged club half as of unknown outcome, replaying nothing after it", async () => {
    calls.length = 0;
    answerWith(() => Promise.resolve({ acknowledged: 0 }));

    assert.deepEqual(await undo(POST, { club: CLUB, saison: SAISON }), unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Teamdaten."));
    assert.deepEqual(
      calls.map((call) => call.action),
      ["patchTeam"],
    );
  });

  it("answers an unacknowledged junction as of unknown outcome, alone or after the club half", async () => {
    answerWith(() => Promise.resolve({ acknowledged: calls.at(-1)?.action === "patchSaisonTeam" ? 0 : 1 }));

    assert.deepEqual(await undo(POST, { saison: SAISON }), unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Saison-Zugehörigkeit."));
    assert.deepEqual(
      await undo(POST, { club: CLUB, saison: SAISON }),
      unacknowledged("Nur die Stammdaten wurden zurückgesetzt. Prüfe die Saison-Zugehörigkeit."),
    );
  });
});
