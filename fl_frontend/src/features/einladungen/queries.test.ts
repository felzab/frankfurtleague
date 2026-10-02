import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { beginRenderPass, itOpensAScopeThatMemoizes, serveServerReactTo } from "@/core/cacheScope.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

/** The module under test, whose `react` import the server build must answer. */
const FEATURE_URL = `${pathToFileURL(import.meta.dirname).href}/`;

serveServerReactTo((parentURL) => parentURL.startsWith(FEATURE_URL));

// Each case its own request, as each page load is: a memoised read would otherwise answer one case from the case before it.
beforeEach(beginRenderPass);

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

const OTHER_TEAM_ID = "b".repeat(24);

const endpointsSince = (before: number): string[] => calls.slice(before).map((call) => call.endpoint);

describe("one team's invite across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("goes to the backend once per team and season in one pass", async () => {
    const before = calls.length;

    await Promise.all([getEinladung(TEAM_ID, SAISON_ID), getEinladung(TEAM_ID, SAISON_ID), getEinladung(OTHER_TEAM_ID, SAISON_ID)]);

    assert.deepEqual(endpointsSince(before).sort(), [
      `/teams/${TEAM_ID}/saisons/${SAISON_ID}/einladung`,
      `/teams/${OTHER_TEAM_ID}/saisons/${SAISON_ID}/einladung`,
    ]);
  });

  /* 0 would be the cross-request leak `"use cache"` opens, reporting an open window after it shut. */
  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    await getEinladung(TEAM_ID, SAISON_ID);
    const before = calls.length;

    beginRenderPass();
    await getEinladung(TEAM_ID, SAISON_ID);
    await getEinladung(TEAM_ID, SAISON_ID);

    assert.deepEqual(endpointsSince(before), [`/teams/${TEAM_ID}/saisons/${SAISON_ID}/einladung`]);
  });
});
