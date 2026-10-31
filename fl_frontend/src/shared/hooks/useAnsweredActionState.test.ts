import { EDGE_REFUSAL_BODY } from "@/kit/edgeRefusal.ts";
import { describe, expect, it } from "vitest";

import { ZU_VIELE_VERSUCHE } from "@/shared/utils/actionError.ts";

import { answeringEdgeRefusal } from "./useAnsweredActionState.ts";

import type { ActionResult } from "@/shared/types/types";

const SENT: ActionResult = { success: true, message: "unterwegs" };

describe("an action's state through the edge's own refusal", () => {
  it("is the action's own answer where it answered", async () => {
    expect(
      await answeringEdgeRefusal(async (_state: ActionResult | undefined): Promise<ActionResult> => SENT)(undefined, undefined),
    ).toStrictEqual(SENT);
  });

  /* As Next's action client raises it: the 429's body is the rejection's message. */
  it("says the edge refused the send and when to try again", async () => {
    const answered = answeringEdgeRefusal(async (_state: ActionResult | undefined): Promise<ActionResult> => {
      throw new Error(EDGE_REFUSAL_BODY);
    });

    expect(await answered(undefined, undefined)).toStrictEqual({ success: false, error: ZU_VIELE_VERSUCHE });
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

      await expect(answered(undefined, undefined), String(rejection)).rejects.toSatisfy((thrown) => thrown === rejection);
    }
  });
});
