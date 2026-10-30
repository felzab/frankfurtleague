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

/** Every request the doubled client was asked for, cumulative across every pass in this file. */
const reads = doubleApiClient(() => ({ format: "list", teams: [], spiele: [], spieltage: [] }));

serveServerReact();

const { getAdminSpiele } = await import("./queries.ts");
const { getAdminSpieltage } = await import("../spieltage/queries.ts");
const { getAdminTeams } = await import("../teams/queries.ts");

const SAISON_ID = "2526";

// By the path alone: a generated call carries its query inside `endpoint`.
const countOf = (endpoint: string): number => reads.filter((read) => read.endpoint.split("?")[0] === endpoint).length;

/** The three counts together, so a per-endpoint delta needs no index into a parallel array. */
const countsNow = (): Map<string, number> => new Map(ENDPOINTS.map((endpoint) => [endpoint, countOf(endpoint)]));

const ENDPOINTS = ["/spiele/list/admin", "/spieltage/list/admin", "/teams/list/admin"];

/** All three reads, each given a FRESHLY BUILT filter object -- what a page does on every call. */
const readAllThree = async (): Promise<unknown[]> =>
  Promise.all([getAdminSpiele({ saison_id: SAISON_ID }), getAdminSpieltage({ saison_id: SAISON_ID }), getAdminTeams({ saison_id: SAISON_ID })]);

describe("the filtered admin reads across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("each goes to the backend once when two boundaries ask the same season", async () => {
    beginRenderPass();
    const before = countsNow();

    // Two boundaries of one page, each writing its own object literal: keyed on identity these
    // would be two different arguments and every read below would count twice.
    await readAllThree();
    await readAllThree();

    for (const [endpoint, count] of before) {
      expect(countOf(endpoint) - count, `${endpoint} went to the backend twice in one render pass`).toBe(1);
    }
  });

  it("separates two filter sets, so a narrowed read is never served the whole season", async () => {
    beginRenderPass();
    const before = countOf("/spiele/list/admin");

    // The season editor's own three fixture reads: same season, three different questions.
    await Promise.all([
      getAdminSpiele({ saison_id: SAISON_ID }),
      getAdminSpiele({ saison_id: SAISON_ID, saison_phase: "playoffs" }),
      getAdminSpiele({ saison_id: SAISON_ID, saison_phase: "gruppenphase" }),
    ]);

    expect(countOf("/spiele/list/admin") - before, "two different filter sets shared one answer").toBe(3);
  });

  it("keys on the filters rather than the order they are written in", async () => {
    beginRenderPass();
    const before = countOf("/spieltage/list/admin");

    await Promise.all([
      getAdminSpieltage({ saison_id: SAISON_ID, saison_phase: "playoffs" }),
      getAdminSpieltage({ saison_phase: "playoffs", saison_id: SAISON_ID }),
    ]);

    expect(countOf("/spieltage/list/admin") - before, "the same filters written in another order paid for a second round trip").toBe(1);
  });

  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    // Primed here rather than leaning on the tests above: a leak is only visible against a pass that
    // already read, and `it` order is not something this should depend on.
    beginRenderPass();
    await readAllThree();
    const before = countsNow();

    beginRenderPass();
    await readAllThree();
    await readAllThree();

    // Split, so each way of being wrong names itself: 0 is the cross-request leak `"use cache"`
    // would open on these reads, and 2 is no memoization at all.
    for (const [endpoint, count] of before) {
      const fetched = countOf(endpoint) - count;
      expect(fetched, `a new request was served the previous request's answer for ${endpoint}`).not.toBe(0);
      expect(fetched, `${endpoint} went to the backend twice in one render pass`).toBe(1);
    }
  });
});
