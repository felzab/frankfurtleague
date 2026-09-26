import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, it } from "node:test";

import { APIBadStatusError } from "@/core/errors";
import { doubleActionRequest, NEXT_HEADERS_DOUBLE } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

/** Stands in for `next/headers`, whose `headers()` needs a request context no test process has. */
const HEADERS_DOUBLE_URL = `data:text/javascript,${encodeURIComponent(NEXT_HEADERS_DOUBLE)}`;

/** What the doubled client throws, so a query's own catch arm is what a case exercises. */
let failure: unknown;

// An administrator's session: every admin-tier read resolves its actor from it before it is sent
// (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
doubleActionRequest();

const calls = doubleApiClient(() => {
  if (failure !== undefined) throw failure;
  return {};
});

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/headers") return { url: HEADERS_DOUBLE_URL, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { getBewerbungById, getBewerbungen, getBewerbungFenster, getBewerbungKuerzel, getBewerbungSchulen, getOffenesBewerbungFenster } =
  await import("./queries.ts");

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

describe("the two admin-tier triage reads", () => {
  /* First, so a double that never ran fails here rather than under every assertion below. */
  it("reaches the backend through the doubled client at all", async () => {
    await getBewerbungen();
    await getBewerbungById(ONE_ID);

    assert.deepEqual(
      calls.map((call) => call.endpoint),
      ["/bewerbungen", `/bewerbungen/${ONE_ID}`],
    );
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
    const notFound = new APIBadStatusError({
      message: "not found",
      url: "http://backend/api/v0/bewerbungen/fenster",
      statusCode: 404,
      serverErrorCode: "DB-COMMON-001",
      endpoint: "/bewerbungen/fenster",
      method: "GET",
      readOnly: false,
      traceId: "0123456789abcdef",
    });

    assert.equal(await failing(notFound, () => getOffenesBewerbungFenster()), null);
    assert.equal(await failing(notFound, () => getBewerbungFenster("2627")), null);
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

      assert.equal(calls.at(-1)?.endpoint, `/bewerbungen/${ONE_ID}%2F..%2Fteams`);
    } finally {
      // Restored because the harness case above asserts the WHOLE recorded array, not a membership.
      calls.length = before;
    }
  });
});
