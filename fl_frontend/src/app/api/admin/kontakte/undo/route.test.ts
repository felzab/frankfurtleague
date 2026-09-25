import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cacheCalls } from "@/shared/testing/actionDoubles.ts";
import { DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, doubleUndoRequest, unacknowledged, undo } from "@/shared/testing/undoRoutes.ts";

/* The real route, called: the request it runs in and the write it replays are the doubles. */
const { answerWith, calls } = doubleUndoRequest("/src/features/kontakte/mutations.ts");
const { POST } = await import("./route.ts");

/** What `fl_frontend/src/features/kontakte/mutations.ts :: patchSaisonTeamKontakte` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte";

/** The stored block the press replays, and the token the save left, as the editor builds them. */
const BODY = { team_id: "6890a1b2c3d4e5f607182932", saison_id: "2026", kontakte: null, kontakte_stand: "9f2c" };

/** The one code whose sentence already says the undo did not run, so it closes on its own words. */
const STALE_BLOCK = "REQ-KONTAKT-001";

describe("the contacts save's undo", () => {
  it("replays the save's own payload through the save's own write", async () => {
    calls.length = 0;
    const answer = await undo(POST, BODY);

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(calls, [{ action: "patchSaisonTeamKontakte", payload: BODY }]);
  });

  /* An undo restores the earlier record, and the save it undoes moved the stored label the save's own
     admission would judge it by, so a label other than the running one is replayed rather than refused. */
  it("replays a seat under the label it was stored with, the running label or not", async () => {
    calls.length = 0;
    const seat = {
      vorname: "Ada",
      nachname: "Byron",
      email: "ada@example.org",
      telefon: "069 111",
      einwilligung: { umfang: "kontaktdaten", text_version: "2026-08", datum: "2026-03-12" },
    };
    const earlier = { ...BODY, kontakte: { trainer: seat, ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null } };

    const answer = await undo(POST, earlier);

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(calls, [{ action: "patchSaisonTeamKontakte", payload: earlier }]);
  });

  /* No cached read holds a contact person, so an invalidation here would clear what the replay never moved. */
  it("clears no cached read, whether the replay lands or is refused", async () => {
    await undo(POST, BODY);
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, DUPLICATE_KEY)));
    await undo(POST, BODY);

    assert.deepEqual(cacheCalls, []);
  });

  it("replays nothing for a body the save's schema refuses, or a caller from another site", async () => {
    calls.length = 0;
    const withoutToken = await undo(POST, { ...BODY, kontakte_stand: undefined });
    const crossSite = await undo(POST, BODY, "cross-site");

    assert.equal(withoutToken.success, false);
    assert.equal(crossSite.success, false);
    assert.deepEqual(calls, []);
  });

  it("words every other refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION).filter((code) => code !== STALE_BLOCK),
      refuse: (code) => answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code))),
      press: () => undo(POST, BODY),
    });
  });

  /* The save's own sentence sends the admin to a form this toast has not got, and the change standing
     after it would say twice that the undo did not run. */
  it("words the stale block for the undo, saying why it did not run", async () => {
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, STALE_BLOCK)));

    const answer = await undo(POST, BODY);

    assert.deepEqual(answer, {
      success: false,
      error:
        "Die Kontakte dieser Saison wurden nach dem Speichern erneut geändert, meistens durch das Löschen einer Kontaktperson. " +
        "Die Rücknahme wurde nicht ausgeführt, damit die gelöschten Angaben nicht wieder eingetragen werden.",
    });
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged replay as of unknown outcome, sending the admin to the contacts", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 0 }));

    assert.deepEqual(await undo(POST, BODY), unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Kontaktdaten."));
  });
});
