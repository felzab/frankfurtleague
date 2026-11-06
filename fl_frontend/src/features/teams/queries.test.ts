import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beginRenderPass, itOpensAScopeThatMemoizes, serveServerReact } from "@/test-support/cacheScope.ts";
import { describe, expect, it, vi } from "vitest";

import type * as AdminRead from "@/shared/utils/adminRead.ts";

// The admin check is the pass's collaborator, never its subject: each read runs as an admitted
// administrator's, and only how often it reaches the backend is judged. Doubled where `queries.ts`
// imports it, so nothing on the path loads the sign-in store.
vi.doMock("@/shared/utils/adminRead.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminRead>()),
  runAdminRead: <T>(read: () => Promise<T>): Promise<T> => read(),
}));

// Replaced at the module boundary rather than the reads being reshaped to admit a seam: the real
// client reaches a backend no test process runs, at a base URL no test run holds.
/** Every request the doubled client was asked for, cumulative across every pass in this file. */
const reads = doubleApiClient(() => ({ teams: [] }));

const TEAMS_ENDPOINT = "/teams/saisons";

serveServerReact();

const { getTeamSaisons } = await import("./queries.ts");

const countOf = (endpoint: string): number => reads.filter((read) => read.endpoint === endpoint).length;

describe("the admin membership lists across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("is fetched once when both `/area/admin/teams` boundaries read the club list", async () => {
    beginRenderPass();
    const before = countOf(TEAMS_ENDPOINT);

    // What the create modal's boundary and the table's each do, and the shape that paid twice.
    await getTeamSaisons();
    await getTeamSaisons();

    expect(countOf(TEAMS_ENDPOINT) - before, "the admin club list went to the backend twice in one render pass").toBe(1);
  });

  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    // Primed here rather than leaning on the tests above: a leak is only visible against a pass that
    // already read, and `it` order is not something this should depend on.
    beginRenderPass();
    await getTeamSaisons();
    const before = countOf(TEAMS_ENDPOINT);

    beginRenderPass();
    await getTeamSaisons();
    await getTeamSaisons();

    // Each way of being wrong names itself: 0 is the cross-request leak `"use cache"` would open on
    // this read, and 2 is no memoization at all.
    const count = countOf(TEAMS_ENDPOINT) - before;
    expect(count, "a new request was served the previous request's admin club list").not.toBe(0);
    expect(count, "the admin club list went to the backend twice in one render pass").toBe(1);
  });
});
