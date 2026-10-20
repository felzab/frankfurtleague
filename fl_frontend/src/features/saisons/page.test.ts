import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { APIBadStatusError, APIMalformedDataError, UnreadGrantError } from "@/core/errors.ts";
import { doubleActionRequest, loggedErrorCodes, loggedErrorTraces } from "@/shared/testing/actionDoubles.ts";
import { answer, answerReadsWith, EDGE_TRACE_ID, EMPTIEST_ANSWER, pageBody, saisonFields } from "@/shared/testing/pageHarness.ts";

import { FLSaisonSchema } from "./schemas.ts";

import type { ReactElement } from "react";
import type { SaisonRolloverContext } from "./types.ts";

// An administrator's session: every admin-tier read resolves its actor from it before it is sent.
doubleActionRequest();

/* Reached with `await import` and never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { default: AdminSaisonEditPage } = await import("@/app/bereich/admin/saisons/[saison_id]/page.tsx");

const VORSCHAU = "/saisons/2026/loeschung/vorschau";

const SAISON = (id: string, status: "active" | "future") => answer(FLSaisonSchema, "/saisons/list/admin", saisonFields(id, status));

/** What the count's read answers in the running case: its fields, or the `Error` it throws. */
let vorschau: Record<string, unknown> | Error = { abgeschlossene_saison_id: "2025", spieler: 3 };

answerReadsWith((endpoint, schema, params) => {
  // A planned season beside a running one: the rollover is on offer, so the page reads the count.
  if (endpoint === "/saisons/list/admin") return answer(schema, endpoint, { saisons: [SAISON("2025", "active"), SAISON("2026", "future")] });
  if (endpoint !== VORSCHAU) return EMPTIEST_ANSWER(endpoint, schema, params);
  if (vorschau instanceof Error) throw vorschau;
  return answer(schema, endpoint, vorschau);
});

beforeEach(() => {
  vorschau = { abgeschlossene_saison_id: "2025", spieler: 3 };
});

/** The planned season's rollover panel as the page hands it to the view. */
async function rollover(): Promise<SaisonRolloverContext> {
  const body = (await pageBody(AdminSaisonEditPage, {
    params: Promise.resolve({ saison_id: "2026" }),
    searchParams: Promise.resolve({}),
  })) as ReactElement<{ rollover: SaisonRolloverContext }>;

  return body.props.rollover;
}

describe("the count beside the rollover press", () => {
  it("hands the panel the count and the season it closes", async () => {
    assert.deepEqual((await rollover()).loeschung, { abgeschlosseneSaisonId: "2025", spieler: 3, eingeschaltet: false });
  });

  /* The page is where a season is activated, and the press needs no count: a read that failed takes the line, never
     the page. */
  it("leaves the page standing, the count said unreadable, where its read failed", async () => {
    vorschau = new APIBadStatusError({
      message: "API returned a bad status.",
      url: "http://backend:8000",
      statusCode: 500,
      serverErrorCode: "DB-FAIL-001",
      endpoint: VORSCHAU,
      method: "GET",
      readOnly: true,
      traceId: "t".repeat(32),
    });

    assert.equal((await rollover()).loeschung, "unlesbar");
  });

  /* A bug in the count's read shows the same unreadable count as a failed read, so only its line tells them apart. */
  it("logs a count read that threw untyped", async () => {
    vorschau = new TypeError("Cannot read properties of undefined (reading 'spieler')");

    assert.equal((await rollover()).loeschung, "unlesbar");
    assert.deepEqual(loggedErrorCodes(), ["FE-RSC-001"], "the failure went unlogged");
    assert.deepEqual(loggedErrorTraces(), [EDGE_TRACE_ID], "the line names no request");
  });

  /* The guard logs an unread grant as it refuses (`FE-AUTH-010`): the count's handler adds no second line. */
  it("logs nothing of its own for a count whose administrator's grant went unread", async () => {
    vorschau = new UnreadGrantError();

    assert.equal((await rollover()).loeschung, "unlesbar");
    assert.deepEqual(loggedErrorCodes(), [], "the guard's outage was logged twice");
  });

  /* A contract break is a deploy out of step, which the error boundary logs, as every degraded read sends one. */
  it("sends a contract break to the error boundary", async () => {
    vorschau = new APIMalformedDataError({
      message: "API returned a body that could not be parsed as JSON.",
      url: "http://backend:8000",
      statusCode: 200,
      endpoint: VORSCHAU,
      method: "GET",
      readOnly: true,
      traceId: "t".repeat(32),
    });

    await assert.rejects(rollover(), APIMalformedDataError);
  });
});
