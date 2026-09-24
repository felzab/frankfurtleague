import { describe, it } from "node:test";

import { doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { assertEachAnswered, publishedRefusals } from "@/shared/testing/publishedRefusals.ts";

import { mapStaleBlockRefusal } from "./refusals.ts";

/* The real action, called: the request it runs in and the write it sends are the doubles. A file of its
   own, `actions.test.ts` and `editor.test.ts` replacing this slice's actions module for the components they render. */
doubleActionRequest();
const { answerWith } = doubleActions({ modules: ["/src/features/kontakte/mutations.ts"] });
const { patchSaisonTeamKontakteAction } = await import("./actions.ts");

const KONTAKTE_OPERATION = "PATCH /teams/{team_id}/saisons/{saison_id}/kontakte";

describe("what the contacts write answers a refusal with", () => {
  /* A block cleared whole, which the schema takes as it stands, so the write reaches the doubled request
     rather than the parse. */
  it("answers every refusal its endpoint publishes with the stale-block mapper", async () => {
    await assertEachAnswered({
      operation: KONTAKTE_OPERATION,
      codes: publishedRefusals(KONTAKTE_OPERATION),
      refuseWith: answerWith,
      act: () =>
        patchSaisonTeamKontakteAction({ team_id: "6890a1b2c3d4e5f607182932", saison_id: "2026", kontakte: null, kontakte_stand: "stand" }),
      mapped: mapStaleBlockRefusal,
    });
  });
});
