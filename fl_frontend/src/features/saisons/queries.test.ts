import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beginRenderPass, itOpensAScopeThatMemoizes, serveServerReact } from "@/test-support/cacheScope.ts";
import { describe, expect, it, vi } from "vitest";

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
const { setSession } = doubleActionRequest();

/** Every cache declaration a read made, which the request's own double answers by recording nothing. */
const declared: string[] = [];
// Registered after the request's doubles, so its `next/cache` answers before theirs.
vi.doMock("next/cache", () => ({ cacheTag: () => void declared.push("cacheTag"), cacheLife: () => void declared.push("cacheLife") }));

// Replaced at the module boundary rather than the season code being reshaped to admit a seam: the
// real client reaches a backend no test process runs, at a base URL no test run holds.
/** Every request the doubled client was asked for, cumulative across every pass in this file. */
const reads = doubleApiClient(({ endpoint }) =>
  endpoint.endsWith("/loeschung/vorschau") ? { acknowledged: 1, abgeschlossene_saison_id: "2526", spieler: 4 } : { saisons: [{ id: "2526" }] },
);

serveServerReact();

const { getAdminSaisons, getLoeschungVorschau } = await import("./queries.ts");
const { resolveSaisonId } = await import("./resolvers.ts");

const adminReads = (): number => reads.filter(({ endpoint }) => endpoint === "/saisons/list/admin").length;

describe("the admin season list across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("is fetched once when the resolver and the page both read it", async () => {
    beginRenderPass();
    const before = adminReads();

    // What one admin Suspense boundary does: check the season named in the URL, then read the list.
    const resolved = await resolveSaisonId(Promise.resolve({ saison_id: "2526" }), "admin");
    await getAdminSaisons();

    expect(resolved).toBe("2526");
    expect(adminReads() - before, "the admin season list went to the backend twice in one render pass").toBe(1);
  });

  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    // Primed here rather than leaning on the test above: a leak is only visible against a pass that
    // already read the list, and `it` order is not something this should depend on.
    beginRenderPass();
    await getAdminSaisons();
    const before = adminReads();

    beginRenderPass();
    await resolveSaisonId(Promise.resolve({ saison_id: "2526" }), "admin");
    await getAdminSaisons();

    // Split, so each way of being wrong names itself: 0 is the cross-request leak `"use cache"`
    // would open on this read, and 2 is no memoization at all.
    const fetched = adminReads() - before;
    expect(fetched, "a new request was served the previous request's admin list").not.toBe(0);
    expect(fetched, "the admin season list went to the backend twice in one render pass").toBe(1);
  });
});

describe("the deletion count the season page reads", () => {
  /* Cached, the count keys on the season id alone: every administrator shares one slot, and a count from before
     another season's activation names people already gone. */
  it("is read on the admin tier in every pass, declaring no cache", async () => {
    const before = reads.length;

    beginRenderPass();
    await getLoeschungVorschau("2627");
    beginRenderPass();
    await getLoeschungVorschau("2627");

    expect(reads.slice(before).map(({ endpoint, authType }) => [endpoint, authType])).toStrictEqual([
      ["/saisons/2627/loeschung/vorschau", "admin"],
      ["/saisons/2627/loeschung/vorschau", "admin"],
    ]);
    expect(declared, "the administrator's count is declared into a cache every caller shares").toStrictEqual([]);
  });

  /* The admin tier's guard, which the page's layout does not give a page's own read (`docs/frontend/spec.md :: I122`). */
  it("sends nothing for a session holding no administrator", async () => {
    setSession(null);
    const before = reads.length;

    beginRenderPass();
    await expect(getLoeschungVorschau("2627")).rejects.toThrow();

    expect(reads.length, "the count was read for a session the guard turns away").toBe(before);
  });
});
