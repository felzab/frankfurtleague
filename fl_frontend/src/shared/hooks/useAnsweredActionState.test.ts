import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { EDGE_REFUSAL_BODY, ZU_VIELE_VERSUCHE } from "@/shared/utils/actionError.ts";

import { answeringEdgeRefusal } from "./useAnsweredActionState.ts";

import type { ActionResult } from "@/shared/types/types";

const SENT: ActionResult = { success: true, message: "unterwegs" };

describe("an action's state through the edge's own refusal", () => {
  it("is the action's own answer where it answered", async () => {
    assert.deepEqual(
      await answeringEdgeRefusal(async (_state: ActionResult | undefined): Promise<ActionResult> => SENT)(undefined, undefined),
      SENT,
    );
  });

  /* As Next's action client raises it: the 429's body is the rejection's message. */
  it("says the edge refused the send and when to try again", async () => {
    const answered = answeringEdgeRefusal(async (_state: ActionResult | undefined): Promise<ActionResult> => {
      throw new Error(EDGE_REFUSAL_BODY);
    });

    assert.deepEqual(await answered(undefined, undefined), { success: false, error: ZU_VIELE_VERSUCHE });
  });

  /* Any other rejection is the boundary's, which a caller placed for it: a send the edge did not refuse may have left. */
  it("hands every other rejection on as it came", async () => {
    for (const rejection of [
      new Error("An unexpected response was received from the server."),
      new Error(`${EDGE_REFUSAL_BODY}\n`),
      EDGE_REFUSAL_BODY,
    ]) {
      const answered = answeringEdgeRefusal(async (_state: ActionResult | undefined): Promise<ActionResult> => {
        throw rejection;
      });

      await assert.rejects(answered(undefined, undefined), (thrown) => thrown === rejection, String(rejection));
    }
  });
});
