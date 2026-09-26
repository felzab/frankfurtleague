import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { doubleActionRequest, NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";

/**
 * `next/headers` resolves only inside a Next build. Answering no traceparent leaves each read
 * minting its own, which is the branch a request without one already takes.
 */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent(NEXT_HEADERS_DOUBLE)}`;

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { calls } = doubleApiAnswers(({ endpoint }) =>
  Promise.resolve(
    endpoint.includes("/vorschau")
      ? { acknowledged: 1, saison_id: SAISON_ID, zeilen: [] }
      : { acknowledged: 1, saison_id: SAISON_ID, team_id: TEAM_ID, einladung: null, laeuft: true },
  ),
);

const { getEinladung, getEinladungVersandVorschau } = await import("./queries.ts");

const TEAM_ID = "a".repeat(24);
const SAISON_ID = "2627";

describe("the invite slice's reads", () => {
  /* The preview describes the press it is shown before: read WITHOUT the re-send choice it answers
     over the other rule, and the page then lists one set of teams while the press writes to
     another. */
  it("carries the re-send choice into the preview's query string, both ways", async () => {
    await getEinladungVersandVorschau(SAISON_ID, false);
    await getEinladungVersandVorschau(SAISON_ID, true);

    const vorschau = `/saisons/${SAISON_ID}/einladungen/versand/vorschau`;
    assert.deepEqual(requestsOf(calls), [
      { endpoint: `${vorschau}?erneut=false`, method: undefined, body: undefined },
      { endpoint: `${vorschau}?erneut=true`, method: undefined, body: undefined },
    ]);
  });

  it("addresses one team's invite by both ids in the path", async () => {
    await getEinladung(TEAM_ID, SAISON_ID);

    assert.deepEqual(requestsOf(calls), [{ endpoint: `/teams/${TEAM_ID}/saisons/${SAISON_ID}/einladung`, method: undefined, body: undefined }]);
  });
});
