import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APIMalformedDataError, APINetworkError } from "@/core/errors.ts";
import { doubleLogger, loggedErrorCodes } from "@/shared/testing/actionDoubles.ts";
import { answerReadsWith, EMPTIEST_ANSWER } from "@/shared/testing/pageHarness.ts";

import type { ReactElement } from "react";

doubleLogger();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { ServerIsLive } = await import("./ServerIsLive.tsx");

const PING = "/system/is_live";
const SENT = { url: `http://backend${PING}`, endpoint: PING, method: "GET", readOnly: true, traceId: "d".repeat(32) };

/** What the ping's read answers: the `Error` it throws, or nothing for its emptiest answer. */
let failure: Error | null = null;

answerReadsWith((endpoint, schema, params) => {
  if (endpoint === PING && failure !== null) throw failure;
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

/** The badge's words for the ping `failure` makes. */
async function badge(thrown: Error): Promise<unknown> {
  failure = thrown;
  const element = (await ServerIsLive()) as ReactElement<{ children: unknown }>;
  return element.props.children;
}

describe("the server status badge", () => {
  it("reads offline where the network never answered the ping, logging nothing", async () => {
    const unanswered = new APINetworkError({ ...SENT, message: "Network request failed.", isTimeout: true });

    assert.equal(await badge(unanswered), "Serverstatus: oFLine");
    assert.deepEqual(loggedErrorCodes(), []);
  });

  /* A bug in the ping's read reads as the outage the badge reports, so only the line tells them apart. */
  it("reads offline for a ping that threw untyped, and logs it", async () => {
    assert.equal(await badge(new TypeError("Cannot read properties of undefined (reading 'acknowledged')")), "Serverstatus: oFLine");
    assert.deepEqual(loggedErrorCodes(), ["FE-RSC-001"]);
  });

  /* Only a deploy repairs a ping answered off its schema, which the badge would otherwise report as an outage. */
  it("sends a ping answered off its schema to the error boundary", async () => {
    await assert.rejects(
      badge(new APIMalformedDataError({ ...SENT, message: "API returned malformed data.", statusCode: 200 })),
      APIMalformedDataError,
    );
  });
});
