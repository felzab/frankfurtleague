import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { beginRenderPass, itOpensAScopeThatMemoizes, serveServerReact } from "@/test-support/cacheScope.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRead from "@/shared/utils/adminRead.ts";

// The admin check is the pass's collaborator, never its subject: each read runs as an admitted
// administrator's, and only how often it reaches the backend is judged. Doubled where `queries.ts`
// imports it, so nothing on the path loads the sign-in store.
vi.doMock("@/shared/utils/adminRead.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminRead>()),
  runAdminRead: <T>(read: () => Promise<T>): Promise<T> => read(),
}));

serveServerReact();

// Each case its own request, as each page load is: a memoised read would otherwise answer one case from the case before it.
beforeEach(beginRenderPass);

const { calls } = doubleApiAnswers(({ endpoint }) =>
  Promise.resolve(
    endpoint.includes("/preview")
      ? { saison_id: SAISON_ID, rows: [] }
      : { saison_id: SAISON_ID, team_id: TEAM_ID, invitation: null, running: true },
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

    const vorschau = `/saisons/${SAISON_ID}/invitations/dispatch/preview`;
    expect(requestsOf(calls)).toStrictEqual([
      { endpoint: `${vorschau}?resend=false`, method: "GET", body: undefined },
      { endpoint: `${vorschau}?resend=true`, method: "GET", body: undefined },
    ]);
  });

  it("addresses one team's invite by both ids in the path", async () => {
    await getEinladung(TEAM_ID, SAISON_ID);

    expect(requestsOf(calls)).toStrictEqual([
      { endpoint: `/teams/${TEAM_ID}/saisons/${SAISON_ID}/invitation`, method: "GET", body: undefined },
    ]);
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

    expect(endpointsSince(before).sort()).toStrictEqual([
      `/teams/${TEAM_ID}/saisons/${SAISON_ID}/invitation`,
      `/teams/${OTHER_TEAM_ID}/saisons/${SAISON_ID}/invitation`,
    ]);
  });

  /* 0 would be the cross-request leak `"use cache"` opens, reporting an open window after it shut. */
  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    await getEinladung(TEAM_ID, SAISON_ID);
    const before = calls.length;

    beginRenderPass();
    await getEinladung(TEAM_ID, SAISON_ID);
    await getEinladung(TEAM_ID, SAISON_ID);

    expect(endpointsSince(before)).toStrictEqual([`/teams/${TEAM_ID}/saisons/${SAISON_ID}/invitation`]);
  });
});
