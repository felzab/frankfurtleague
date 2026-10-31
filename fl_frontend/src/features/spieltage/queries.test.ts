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
const reads = doubleApiClient(() => ({ spieltag: {} }));

serveServerReact();

const { getAdminSpieltagById } = await import("./queries.ts");

const endpointsSince = (before: number): string[] => reads.slice(before).map((read) => read.endpoint);

describe("the matchday editor's read across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("goes to the backend once per matchday in one pass", async () => {
    beginRenderPass();
    const before = reads.length;

    await Promise.all([getAdminSpieltagById("s1"), getAdminSpieltagById("s1"), getAdminSpieltagById("s2")]);

    expect(endpointsSince(before).sort()).toStrictEqual(["/spieltage/s1/verwaltung", "/spieltage/s2/verwaltung"]);
  });

  /* 0 would be the cross-request leak `"use cache"` opens on an admin-tier read. */
  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    beginRenderPass();
    await getAdminSpieltagById("s1");
    const before = reads.length;

    beginRenderPass();
    await getAdminSpieltagById("s1");
    await getAdminSpieltagById("s1");

    expect(endpointsSince(before)).toStrictEqual(["/spieltage/s1/verwaltung"]);
  });
});
