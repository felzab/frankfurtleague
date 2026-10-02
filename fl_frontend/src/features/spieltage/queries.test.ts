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
const reads = doubleApiClient(() => ({ acknowledged: 1, spieltag: {} }));

serveServerReactTo((parentURL) => parentURL.startsWith(FEATURE_URL));

const { getAdminSpieltagById } = await import("./queries.ts");

const endpointsSince = (before: number): string[] => reads.slice(before).map((read) => read.endpoint);

describe("the matchday editor's read across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  it("goes to the backend once per matchday in one pass", async () => {
    beginRenderPass();
    const before = reads.length;

    await Promise.all([getAdminSpieltagById("s1"), getAdminSpieltagById("s1"), getAdminSpieltagById("s2")]);

    assert.deepEqual(endpointsSince(before).sort(), ["/spieltage/s1/admin", "/spieltage/s2/admin"]);
  });

  /* 0 would be the cross-request leak `"use cache"` opens on an admin-tier read. */
  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    beginRenderPass();
    await getAdminSpieltagById("s1");
    const before = reads.length;

    beginRenderPass();
    await getAdminSpieltagById("s1");
    await getAdminSpieltagById("s1");

    assert.deepEqual(endpointsSince(before), ["/spieltage/s1/admin"]);
  });
});
