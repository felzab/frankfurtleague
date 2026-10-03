import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { beginRenderPass, itOpensAScopeThatMemoizes, serveServerReactTo } from "@/core/cacheScope.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

/** The module under test, whose `react` import the server build must answer. */
const FEATURE_URL = `${pathToFileURL(import.meta.dirname).href}/`;

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

/** Every request the doubled client was asked for, cumulative across every pass in this file. */
const reads = doubleApiClient(({ endpoint }) => ({ acknowledged: 1, saison_id: endpoint.split("/").at(-1), nachnominierung: false }));

serveServerReactTo((parentURL) => parentURL.startsWith(FEATURE_URL));

const { getSpielerNachnominierung } = await import("./queries.ts");

const endpointsSince = (before: number): string[] => reads.slice(before).map((read) => read.endpoint);

describe("the late-registration read across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("goes to the backend once per season in one pass", async () => {
    beginRenderPass();
    const before = reads.length;

    await Promise.all([getSpielerNachnominierung("2526"), getSpielerNachnominierung("2526"), getSpielerNachnominierung("2627")]);

    assert.deepEqual(endpointsSince(before).sort(), ["/spieler/nachnominierung/2526", "/spieler/nachnominierung/2627"]);
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

    assert.deepEqual(endpointsSince(before), ["/spieler/nachnominierung/2526"]);
  });
});
