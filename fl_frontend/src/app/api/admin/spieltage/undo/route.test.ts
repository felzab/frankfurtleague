import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { assertEachRefusalCloses, doubleUndoRequest, undo } from "@/shared/testing/undoRoutes.ts";

/* The real route, called: the request it runs in and the write it replays are the doubles. */
const { answerWith, calls } = doubleUndoRequest("/src/features/spieltage/mutations.ts");
const { POST } = await import("./route.ts");

/** What `fl_frontend/src/features/spieltage/mutations.ts :: patchSpieltag` sends, as the backend's own routes spell it. */
const REPLAY_OPERATION = "PATCH /spieltage/{spieltag_id}";

/** The pre-save span the press replays, as the editor builds it. */
const BODY = { id: "6890a1b2c3d4e5f607a20001", beginn: "2026-04-01", ende: "2026-04-05" };

describe("the matchday save's undo", () => {
  it("replays the stored span", async () => {
    calls.length = 0;
    const answer = await undo(POST, BODY);

    assert.equal(answer.success, true, String(answer.error));
    assert.deepEqual(
      calls.map((call) => call.action),
      ["patchSpieltag"],
    );
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
});
