import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { saisonRules } from "@/shared/testing/saisonRules.ts";
import { assertEachRefusalCloses, doubleRouteRequest, revalidatedTags, unacknowledged, undo } from "@/shared/testing/undoRoutes.ts";

/* The real route and the mutation it replays through, called: the request it runs in and the backend client are the doubles. */
doubleRouteRequest();
const { answerWith, calls } = doubleApiAnswers(() => Promise.resolve(replayed(1)));
const { POST } = await import("./route.ts");

/** What `fl_frontend/src/features/saisons/mutations.ts :: patchSaison` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /saisons/{saison_id}";

const RULES = saisonRules();

/** The pre-save season the press replays, as the editor builds it. */
const BODY = { id: "2026", start_date: "2026-03-01", end_date: "2026-07-01", rules: RULES, bewerbung: null, registrierung: null };

/** The replay's answer as the backend sends it, the season restored. */
const replayed = (acknowledged: 0 | 1) => ({
  acknowledged,
  updated_document: { ...BODY, status: "future", schedule: [], spielplan: null },
});

describe("the season save's undo", () => {
  it("replays the stored season", async () => {
    const answer = await undo(POST, BODY);

    assert.equal(answer.success, true, String(answer.error));
    const { id, ...season } = BODY;
    assert.deepEqual(requestsOf(calls), [{ endpoint: `/saisons/${id}`, method: "PATCH", body: season }]);
    // The caches the replay moves, which the undo spine drops with no staleness tolerated.
    assert.deepEqual(revalidatedTags(), [
      ["saisons", { expire: 0 }],
      ["teams", { expire: 0 }],
    ]);
  });

  it("words every refusal the replayed endpoint publishes, closing on the change standing once", async () => {
    await assertEachRefusalCloses({
      codes: publishedRefusals(REPLAY_OPERATION),
      refuse: (code) => answerWith(() => Promise.reject(refusedOn(REPLAY_OPERATION, code))),
      press: () => undo(POST, BODY),
    });
  });

  /* It may still have landed, so it is titled unclear and never says the change stands. */
  it("answers an unacknowledged replay as of unknown outcome, sending the admin to the season", async () => {
    answerWith(() => Promise.resolve(replayed(0)));

    assert.deepEqual(await undo(POST, BODY), unacknowledged("Die Rücknahme wurde abgebrochen. Prüfe die Saisondaten."));
  });
});
