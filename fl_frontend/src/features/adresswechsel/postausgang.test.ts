import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APIBadStatusError } from "@/core/errors.ts";

import type { FLAdresswechselZugestelltResponse } from "@/core/generated/client/types.ts";
import type { ApiCall } from "@/test-support/apiClientDouble.ts";

/* The real drain over the backend client's double; what it delivers each notice through is a double too, the notices
   themselves being `notifications.test.ts`'s. */
type Line = { level: string; event: string; fields: unknown };

const lines: Line[] = [];
const record =
  (level: string) =>
  (event: string, ...rest: unknown[]): void =>
    void lines.push({ level, event, fields: rest.at(-1) });

/** Each notice the drain delivered, by its new address. */
const delivered: string[] = [];

vi.doMock("@/core/logging.ts", () => ({
  logger: { debug: record("DEBUG"), info: record("INFO"), warn: record("WARN"), error: record("ERROR") },
}));
vi.doMock("@/features/adresswechsel/notifications.ts", () => ({
  adresswechselWirksam: ({ mitteilung }: { mitteilung: { email: string } }) => {
    delivered.push(mitteilung.email);
    return Promise.resolve(true);
  },
  mailAdresswechselNichtWirksam: ({ email }: { email: string }) => {
    delivered.push(email);
    return Promise.resolve(true);
  },
}));

const CLAIM = "/adresswechsel/sweep/postausgang";
const ROW = "6890a1b2c3d4e5f6071c0001";

const notice = {
  id: ROW,
  art: "verworfen",
  bisherige_email: null,
  email: "neu@schule.de",
  vorname: null,
  weg: null,
  aufgegeben: false,
};
const claimOf = (mitteilungen: unknown[]) => ({
  beanspruchung: mitteilungen.length === 0 ? null : "claim-1",
  beansprucht_bis: mitteilungen.length === 0 ? null : "2026-10-21T10:10:00Z",
  mitteilungen: mitteilungen,
});

/** What each claim answers in turn, the last repeated; or a throw where a case says the backend is down. */
let claims: unknown[] = [];
let holdClaim: Promise<void> | null = null;
let stampFails: Error | null = null;

const calls = doubleApiClient((call: ApiCall) => {
  if (call.endpoint === CLAIM) {
    return (holdClaim ?? Promise.resolve()).then(() => {
      const next = claims.length > 1 ? claims.shift() : claims[0];
      if (next instanceof Error) throw next;
      return next;
    });
  }

  if (stampFails !== null) return Promise.reject(stampFails);
  const ids = (JSON.parse(call.body ?? "{}") as { ids: string[] }).ids;
  return { zugestellt: ids.length, ignoriert: 0 } satisfies FLAdresswechselZugestelltResponse;
});

const { runAdresswechselPostausgang } = await import("./postausgang.ts");

const claimed = (): number => calls.filter((call) => call.endpoint === CLAIM).length;

beforeEach(() => {
  calls.length = 0;
  lines.length = 0;
  delivered.length = 0;
  claims = [claimOf([])];
  holdClaim = null;
  stampFails = null;
});

describe("the address change's outbox drain", () => {
  it("settles where the claim fails, logging the name alone", async () => {
    claims = [new Error("the backend answered nothing")];

    await runAdresswechselPostausgang();

    expect(lines.map((line) => [line.event, line.fields])).toStrictEqual([["adresswechsel.postausgang_failed", { name: "Error" }]]);
  });

  /* The status and code tell a refusal from a crash, and the trace finds the backend's own line. */
  it("carries a refused claim's status, code and trace", async () => {
    claims = [
      new APIBadStatusError({
        message: "API returned a bad status.",
        url: "http://backend:8000",
        statusCode: 503,
        serverErrorCode: "DB-FAIL-001",
        endpoint: CLAIM,
        method: "POST",
        readOnly: false,
        traceId: "t".repeat(32),
      }),
    ];

    await runAdresswechselPostausgang();

    expect(lines.map((line) => [line.event, line.fields])).toStrictEqual([
      [
        "adresswechsel.postausgang_failed",
        { name: "APIBadStatusError", status: 503, server_error_code: "DB-FAIL-001", trace_id: "t".repeat(32) },
      ],
    ]);
  });

  /* The notice stays held until the lease lapses and goes again; the runbook greps this line. */
  it("settles where the stamp fails, logging the name alone and claiming no further page", async () => {
    claims = [claimOf([notice]), claimOf([])];
    stampFails = new TypeError("fetch failed");

    await runAdresswechselPostausgang();

    expect(delivered).toStrictEqual(["neu@schule.de"]);
    expect(claimed(), "a page whose stamp failed was followed by another claim").toBe(1);
    expect(lines.map((line) => [line.event, line.fields])).toStrictEqual([["adresswechsel.stempel_failed", { name: "TypeError" }]]);
  });
});

describe("two drains asked for at once", () => {
  /* A confirmation landing while a drain runs would otherwise wait for the hourly pass: its account carry with it, while
     the page already told the person to sign in at the new address. */
  it("runs the second after the first rather than beside it or not at all", async () => {
    let release = (): void => undefined;
    holdClaim = new Promise((resolve) => {
      release = resolve;
    });

    const first = runAdresswechselPostausgang();
    const second = runAdresswechselPostausgang();
    const third = runAdresswechselPostausgang();
    await second;
    await third;
    expect(claimed(), "a second drain claimed beside the first").toBe(1);

    holdClaim = null;
    release();
    await first;

    expect(claimed(), "the asks made while the first ran were dropped, or each ran a drain of its own").toBe(2);
  });
});
