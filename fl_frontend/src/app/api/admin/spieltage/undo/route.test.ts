import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, doubleRouteRequest, unacknowledged, undo } from "@/shared/testing/undoRoutes.ts";

/* The real route and the mutation it replays through, called: the request it runs in and the backend client are the doubles. */
doubleRouteRequest();
const { answerWith, calls } = doubleApiAnswers();
const { POST } = await import("./route.ts");

/** What `fl_frontend/src/features/spieltage/mutations.ts :: patchSpieltag` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /spieltage/{spieltag_id}";

/** The pre-save span the press replays, as the editor builds it. */
const BODY = { id: "6890a1b2c3d4e5f607a20001", beginn: "2026-04-01", ende: "2026-04-05" };

describe("the matchday save's undo", () => {
  it("replays the stored span", async () => {
    const answer = await undo(POST, BODY);

    assert.equal(answer.success, true, String(answer.error));
    const { id, ...span } = BODY;
    assert.deepEqual(requestsOf(calls), [{ endpoint: `/spieltage/${id}`, method: "PATCH", body: span }]);
  });

  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION),
      refuse: (code) => answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code))),
      press: () => undo(POST, BODY),
    });
  });

  /* One code carries the refusal on either side of this matchday, so the replay claims the ordering
     among the dated matchdays as the save and its warning do (`fl_frontend/src/features/spieltage/actions.test.ts`). */
  it("words the ordering refusal as the ordering among the dated matchdays", async () => {
    answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, "REQ-DATE-008")));

    const answer = await undo(POST, BODY);

    assert.match(answer.error ?? "", /in die Reihenfolge der Spieltage seiner Phase/);
    assert.match(answer.error ?? "", /schon einen Zeitraum haben/);
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged replay as of unknown outcome, sending the admin to the matchday", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 0 }));

    assert.deepEqual(await undo(POST, BODY), unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe den Spieltag."));
  });
});
