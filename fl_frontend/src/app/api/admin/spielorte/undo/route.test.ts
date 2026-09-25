import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, doubleRouteRequest, unacknowledged, undo } from "@/shared/testing/undoRoutes.ts";

/* The real route and the mutation it replays through, called: the request it runs in and the backend client are the doubles. */
doubleRouteRequest();
const { answerWith, calls } = doubleApiAnswers();
const { POST } = await import("./route.ts");

/** What `fl_frontend/src/features/spielorte/mutations.ts :: patchSpielort` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /spielorte/{spielort_id}";

/** The pre-save venue the press replays, as the editor builds it. */
const BODY = {
  id: "6890a1b2c3d4e5f607a30001",
  name: "Sportpark Nord",
  default_mietpreis: 40,
  address: { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
};

describe("the venue save's undo", () => {
  it("replays the stored venue", async () => {
    const answer = await undo(POST, BODY);

    assert.equal(answer.success, true, String(answer.error));
    const { id, ...fields } = BODY;
    assert.deepEqual(requestsOf(calls), [{ endpoint: `/spielorte/${id}`, method: "PATCH", body: fields }]);
  });

  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION),
      refuse: (code) => answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code))),
      press: () => undo(POST, BODY),
    });
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged replay as of unknown outcome, sending the admin to the venue", async () => {
    answerWith(() => Promise.resolve({ acknowledged: 0 }));

    assert.deepEqual(await undo(POST, BODY), unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Spielortdaten."));
  });
});
