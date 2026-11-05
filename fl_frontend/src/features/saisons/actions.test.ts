import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { answerShown, assertEachAnswered, refusalCodes } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import { mapSwapRefusal } from "./refusals.ts";

/* The real action and its mutation, called: the request it runs in and the backend client are the doubles. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers();
const { swapGruppenAction } = await import("./actions.ts");

const SAISON_ID = "2026";
const TEAM1_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const TEAM2_ID = "68c1f0a2b3c4d5e6f7a8b9c1";

describe("the old team editor's group swap", () => {
  it("reaches its published path and method, the season in the path and the pair alone in the body", async () => {
    answerWith(() =>
      Promise.resolve({
        saison_id: SAISON_ID,
        team1_id: TEAM1_ID,
        team1_gruppe: "B",
        team2_id: TEAM2_ID,
        team2_gruppe: "A",
        rewritten_spiele: 0,
      }),
    );

    await swapGruppenAction({ saison_id: SAISON_ID, team1_id: TEAM1_ID, team2_id: TEAM2_ID });

    expect(requestsOf(calls)).toStrictEqual([
      { endpoint: `/saisons/${SAISON_ID}/gruppen/swap`, method: "POST", body: { team1_id: TEAM1_ID, team2_id: TEAM2_ID } },
    ]);
  });

  it("answers every refusal the group swap publishes", async () => {
    for (const code of refusalCodes("swap_not_a_swap", "swap_saison_started", "saison_past", "swap_sides_taken_place")) {
      expect(answerShown(code, mapSwapRefusal), `${code} reaches the admin as a generic failure`).not.toBe(null);
    }
    await assertEachAnswered({
      codes: refusalCodes("swap_not_a_swap", "swap_saison_started", "saison_past", "swap_sides_taken_place"),
      refuseWith: answerWith,
      act: () => swapGruppenAction({ saison_id: SAISON_ID, team1_id: TEAM1_ID, team2_id: TEAM2_ID }),
      mapped: mapSwapRefusal,
    });
  });
});
