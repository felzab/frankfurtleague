import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { isValidElement } from "react";

import { APIMalformedDataError, APINetworkError } from "@/core/errors.ts";
import { doubleLogger, loggedErrorCodes } from "@/shared/testing/actionDoubles.ts";
import { answer, answerReadsWith, EMPTIEST_ANSWER, saisonFields } from "@/shared/testing/pageHarness.ts";

import { FLSaisonSchema } from "../../../saisons/schemas.ts";

import type { ReactNode } from "react";

doubleLogger();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { RecentAndUpcomingSpieleGrid } = await import("./RecentAndUpcomingSpieleGrid.tsx");

const SPIELE = "/spiele";
const SENT = { url: `http://backend${SPIELE}`, endpoint: SPIELE, method: "GET", readOnly: true, traceId: "e".repeat(32) };

/** What the past results' read throws, the upcoming read answering whatever `/spiele` answers empty. */
let vergangen: Error | null = null;

answerReadsWith((endpoint, schema, params) => {
  // A running season, so the grid reads both sections.
  if (endpoint === "/saisons/current")
    return answer(schema, endpoint, { saison: answer(FLSaisonSchema, endpoint, saisonFields("2026", "active")) });
  if (endpoint === SPIELE && params.spiel_status === "vergangen" && vergangen !== null) throw vergangen;
  return EMPTIEST_ANSWER(endpoint, schema, params);
});

beforeEach(() => {
  vergangen = null;
});

/** Whether each section, upcoming then past, was handed an answer rather than the failed read's `null`. */
async function sectionsAnswered(): Promise<boolean[]> {
  const walk = (node: ReactNode): boolean[] => {
    if (Array.isArray(node)) return node.flatMap(walk);
    if (!isValidElement<{ res?: unknown; children?: ReactNode }>(node)) return [];
    return "res" in node.props ? [node.props.res !== null] : walk(node.props.children);
  };
  return walk(await RecentAndUpcomingSpieleGrid());
}

describe("the landing page's fixture grid", () => {
  it("shows the failed panel for a section the network never answered, logging nothing", async () => {
    vergangen = new APINetworkError({ ...SENT, message: "Network request failed.", isTimeout: true });

    assert.deepEqual(await sectionsAnswered(), [true, false]);
    assert.deepEqual(loggedErrorCodes(), []);
  });

  /* A bug in a section's read shows the same panel as an outage, so only the line tells them apart. */
  it("shows the failed panel for a section whose read threw untyped, and logs it", async () => {
    vergangen = new TypeError("Cannot read properties of undefined (reading 'spiele')");

    assert.deepEqual(await sectionsAnswered(), [true, false]);
    assert.deepEqual(loggedErrorCodes(), ["FE-RSC-001"]);
  });

  /* Only a deploy repairs a read answered off its schema, so no section shows it as an outage. */
  it("sends a section's answer off its schema to the error boundary", async () => {
    vergangen = new APIMalformedDataError({ ...SENT, message: "API returned malformed data.", statusCode: 200 });

    await assert.rejects(sectionsAnswered(), APIMalformedDataError);
  });
});
