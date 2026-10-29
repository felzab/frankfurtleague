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
const reads = doubleApiClient(({ endpoint }) => ({ acknowledged: 1, saison_id: endpoint.split("/").at(-1), nachnominierung: false }));

serveServerReact();

const { getSpielerNachnominierung } = await import("./queries.ts");

const endpointsSince = (before: number): string[] => reads.slice(before).map((read) => read.endpoint);

describe("the late-registration read across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("goes to the backend once per season in one pass", async () => {
    beginRenderPass();
    const before = reads.length;

    await Promise.all([getSpielerNachnominierung("2526"), getSpielerNachnominierung("2526"), getSpielerNachnominierung("2627")]);

    expect(endpointsSince(before).sort()).toStrictEqual(["/spieler/nachnominierung/2526", "/spieler/nachnominierung/2627"]);
  });

  /* 0 would be the cross-request leak `"use cache"` opens on an admin-tier read, and the answer turns
     over at midnight besides. */
  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    beginRenderPass();
    await getSpielerNachnominierung("2526");
    const before = reads.length;

    beginRenderPass();
    await getSpielerNachnominierung("2526");
    await getSpielerNachnominierung("2526");

    expect(endpointsSince(before)).toStrictEqual(["/spieler/nachnominierung/2526"]);
  });
});
