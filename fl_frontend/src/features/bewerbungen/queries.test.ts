import { NEXT_HEADERS_DOUBLE } from "@/test-support/actionDoubles.ts";
import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beginRenderPass, itOpensAScopeThatMemoizes, serveServerReact } from "@/test-support/cacheScope.ts";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import type * as AdminRead from "@/shared/utils/adminRead.ts";

/** What the doubled client throws, so a query's own catch arm is what a case exercises. */
let failure: unknown;

// The admin check is the pass's collaborator, never its subject: each read runs as an admitted
// administrator's, and only how often it reaches the backend is judged. Doubled where `queries.ts`
// imports it, so nothing on the path loads the sign-in store.
vi.doMock("@/shared/utils/adminRead.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof AdminRead>()),
  runAdminRead: <T>(read: () => Promise<T>): Promise<T> => read(),
}));
// The public reads forward the visitor's headers, which Next answers only inside a request it serves.
vi.doMock("next/headers", () => NEXT_HEADERS_DOUBLE);

const calls = doubleApiClient(() => {
  if (failure !== undefined) throw failure;
  return {};
});

serveServerReact();

// Each case its own request, as each page load is: a memoised read would otherwise answer one case from the case before it.
beforeEach(beginRenderPass);

const { getBewerbungById, getBewerbungen, getBewerbungFenster, getBewerbungKuerzel, getBewerbungSchulen, getOffenesBewerbungFenster } =
  await import("./queries.ts");
const { refused } = await import("@/test-support/refusals.ts");

/**
 * Runs `read` against a client that throws, and leaves `calls` as it found it: the cases below
 * compare the recorded endpoints exactly, and a call that failed on purpose is not one of them.
 */
async function failing<T>(error: unknown, read: () => Promise<T>): Promise<T> {
  const before = calls.length;
  failure = error;

  try {
    return await read();
  } finally {
    failure = undefined;
    calls.length = before;
  }
}

const ONE_ID = "0123456789abcdef01234567";
const OTHER_ID = "0123456789abcdef01234568";

describe("the two admin-tier triage reads", () => {
  /* First, so a double that never ran fails here rather than under every assertion below. */
  it("reaches the backend through the doubled client at all", async () => {
    await getBewerbungen();
    await getBewerbungById(ONE_ID);

    expect(calls.map((call) => call.endpoint)).toStrictEqual(["/bewerbungen", `/bewerbungen/${ONE_ID}`]);
  });
});

describe("the four base-tier public reads", () => {
  /* First, for the reason the triage's own harness assertion gives: a double that never ran would
     leave `calls` empty and every assertion below would fail for the harness rather than the source. */
  it("reaches the backend through the doubled client at all", async () => {
    await getOffenesBewerbungFenster();
    await getBewerbungFenster("2627");
    await getBewerbungSchulen();
    await getBewerbungKuerzel("GG");

    for (const endpoint of ["/bewerbungen/fenster", "/bewerbungen/fenster/2627", "/bewerbungen/schulen", "/bewerbungen/kuerzel/GG"]) {
      assert.ok(
        calls.some((call) => call.endpoint === endpoint),
        `nothing asked for ${endpoint}`,
      );
    }
  });

  /* Both path interpolations encode, for the reason the Kürzel's always has: a caller-supplied segment
     reaching a URL raw is one that can leave the path it was written into. */
  it("encodes every caller-supplied path segment", async () => {
    await getBewerbungFenster("26/27");
    await getBewerbungKuerzel("G/G");

    for (const endpoint of ["/bewerbungen/fenster/26%2F27", "/bewerbungen/kuerzel/G%2FG"]) {
      assert.ok(
        calls.some((call) => call.endpoint === endpoint),
        `a path segment reached the client unencoded; expected ${endpoint}`,
      );
    }
  });

  /* A season the visitor may not read is a state rather than a failure: the page renders „noch nicht
     offen“ or „abgelaufen“ off it, and a throw here would answer the error page instead. */
  it("reads a 404 on either window as no window rather than as a failure", async () => {
    expect(await failing(refused("document_not_found"), () => getOffenesBewerbungFenster())).toBe(null);
    expect(await failing(refused("document_not_found"), () => getBewerbungFenster("2627"))).toBe(null);
  });
});

describe("the one path segment a caller interpolates", () => {
  /* `fl_frontend/src/core/apiPath.ts :: isPathAsSpelled` cannot see an id carrying a plain `/`: it
     survives parsing untouched and reads as a nested endpoint. Only the caller can refuse it, and
     today's 24-hex id schema makes that positional. */
  it("encodes the id rather than letting it open a path segment", async () => {
    const before = calls.length;

    try {
      await getBewerbungById(`${ONE_ID}/../teams`);

      expect(calls.at(-1)?.endpoint).toBe(`/bewerbungen/${ONE_ID}%2F..%2Fteams`);
    } finally {
      // Restored because the harness case above asserts the WHOLE recorded array, not a membership.
      calls.length = before;
    }
  });
});

const endpointsSince = (before: number): string[] => calls.slice(before).map((call) => call.endpoint);

describe("the two memoised reads across a render pass", () => {
  /* First, so a scope that failed to take fails here rather than under every count below. */
  itOpensAScopeThatMemoizes();

  /* The window page's metadata and body each read the window, and a triage decision reads the application its page read. */
  it("goes to the backend once per application and once per window in one pass", async () => {
    const before = calls.length;

    await Promise.all([getBewerbungById(ONE_ID), getBewerbungById(ONE_ID), getBewerbungById(OTHER_ID)]);
    await Promise.all([getBewerbungFenster("2627"), getBewerbungFenster("2627"), getBewerbungFenster("2728")]);

    expect(endpointsSince(before).sort()).toStrictEqual([
      `/bewerbungen/${ONE_ID}`,
      `/bewerbungen/${OTHER_ID}`,
      "/bewerbungen/fenster/2627",
      "/bewerbungen/fenster/2728",
    ]);
  });

  /* 0 would be the cross-request leak `"use cache"` opens: another request's personal data, and a
     window's `laeuft` judged against a day that has passed. */
  it("is fetched again in the next pass, so no request is served another's copy", async () => {
    await getBewerbungById(ONE_ID);
    await getBewerbungFenster("2627");
    const before = calls.length;

    beginRenderPass();
    await Promise.all([getBewerbungById(ONE_ID), getBewerbungFenster("2627")]);
    await Promise.all([getBewerbungById(ONE_ID), getBewerbungFenster("2627")]);

    expect(endpointsSince(before).sort()).toStrictEqual([`/bewerbungen/${ONE_ID}`, "/bewerbungen/fenster/2627"]);
  });
});
