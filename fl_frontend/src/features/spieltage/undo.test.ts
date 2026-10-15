import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, droppedTags, unacknowledged } from "@/shared/testing/undoActions.ts";

/** The pre-save span the press replays, as the editor builds it. */
const BODY = { id: "6890a1b2c3d4e5f607a20001", beginn: "2026-04-01", ende: "2026-04-05" };

/** The replay's answer as the backend sends it, the span restored. */
const replayed = (acknowledged: 0 | 1) => ({
  acknowledged,
  spieltag_id: BODY.id,
  updated_document: { ...BODY, anzahl_spiele: 4, position: 1, saison_phase: "gruppenphase", saison_id: "2026" },
});

/* The real action and the mutation it replays through, called: the request it runs in and the backend client are the doubles. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers(() => Promise.resolve(replayed(1)));
const { undoAdminSpieltagEditAction } = await import("./actions.ts");

/** What `fl_frontend/src/features/spieltage/mutations.ts :: patchSpieltag` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /spieltage/{spieltag_id}";

describe("the matchday save's undo", () => {
  it("replays the stored span", async () => {
    const answer = await undoAdminSpieltagEditAction(BODY);

    assert.equal(answer.success, true, JSON.stringify(answer));
    const { id, ...span } = BODY;
    assert.deepEqual(requestsOf(calls), [{ endpoint: `/spieltage/${id}`, method: "PATCH", body: span }]);
    // The cache the replay moves, which the spine drops at once.
    assert.deepEqual(droppedTags(), ["spieltage"]);
  });

  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION),
      refuse: (code) => answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code))),
      press: () => undoAdminSpieltagEditAction(BODY),
    });
  });

  /* One code carries the refusal on either side of this matchday, so the replay claims the ordering
     among the dated matchdays as the save and its warning do (`fl_frontend/src/features/spieltage/actions.test.ts`). */
  it("words the ordering refusal as the ordering among the dated matchdays", async () => {
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, "REQ-DATE-008")));

    const answer = await undoAdminSpieltagEditAction(BODY);

    assert.equal(answer.success, false);
    assert.match(answer.success ? "" : answer.error, /in die Reihenfolge der Spieltage seiner Phase/);
    assert.match(answer.success ? "" : answer.error, /schon einen Zeitraum haben/);
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged replay as of unknown outcome, sending the admin to the matchday", async () => {
    answerWith(() => Promise.resolve(replayed(0)));

    assert.deepEqual(await undoAdminSpieltagEditAction(BODY), unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe den Spieltag."));
  });
});
