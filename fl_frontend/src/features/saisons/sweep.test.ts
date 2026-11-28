import { beforeEach, describe, expect, it } from "vitest";

import { APIBadStatusError } from "@/core/errors";
import { networkFailure, refusal, serveBackend } from "@/test-support/backend";
import { captureLog } from "@/test-support/stdoutCapture";

import type { FLBewerbungSweepResponse, FLRegistrierungSweepResponse, FLSaisonRetentionResponse } from "@/core/generated/client/types";

/** One season half's answer, the rows it passed over counted. */
const bewerbungPass = (failed = 0): FLBewerbungSweepResponse => ({ failed });
const registrierungPass = (failed = 0): FLRegistrierungSweepResponse => ({ failed });
const saisonPass = (failed = 0): FLSaisonRetentionResponse => ({ failed });

/** The season listing, which the contract reads with a GET; every other call of the pass is a POST. */
const LISTING = "GET /saisons/sweep";

/** Each request's answer, by its method and path; a request no entry names fails the case. */
let answers: Map<string, () => unknown>;

/**
 * Every season answered, each half's passed-over rows as `passedOver` names them, and each request `fails` names failed
 * on the network.
 */
function seasons(saisonIds: string[], { passedOver = {}, fails = [] }: { passedOver?: Record<string, number>; fails?: string[] } = {}): void {
  answers = new Map<string, () => unknown>([
    [LISTING, () => ({ saison_ids: saisonIds })],
    ...saisonIds.flatMap((saisonId): [string, () => unknown][] => [
      [`POST /bewerbungen/saisons/${saisonId}/sweep`, () => bewerbungPass(passedOver[`/bewerbungen/saisons/${saisonId}/sweep`])],
      [`POST /registrierungen/saisons/${saisonId}/sweep`, () => registrierungPass(passedOver[`/registrierungen/saisons/${saisonId}/sweep`])],
      [`POST /saisons/${saisonId}/sweep`, () => saisonPass(passedOver[`/saisons/${saisonId}/sweep`])],
    ]),
  ]);
  for (const failing of fails) answers.set(failing, networkFailure);
}

const backend = serveBackend(({ method, path }) => answers.get(`${method} ${path}`)?.());
/** Every line the real logger writes, read off standard output. */
const log = captureLog();

const { runSaisonSweep } = await import("./sweep");

/** Every request in the order sent. */
const order = (): string[] => backend.sent.map(({ method, path }) => `${method} ${path}`);

/** The trace a request was sent under, off the `traceparent` the backend read: `00-<trace>-<span>-<flags>`. */
const traceOf = (call: string): string | undefined =>
  backend.sent
    .find(({ method, path }) => `${method} ${path}` === call)
    ?.headers.get("traceparent")
    ?.split("-")[1];

beforeEach(() => {
  seasons([]);
});

describe("one pass of the seasons' job", () => {
  /* What the heartbeat names: the rows a pass left owed, which only a sum over every season and every half tells
     apart from a healthy pass. A season whose retention half went unasked would count none of its rows. */
  it("leaves every row the halves passed over, each half counted", async () => {
    seasons(["2526", "2627"], {
      passedOver: {
        "/bewerbungen/saisons/2526/sweep": 1,
        "/bewerbungen/saisons/2627/sweep": 6,
        "/registrierungen/saisons/2627/sweep": 8,
        "/saisons/2526/sweep": 3,
        "/saisons/2627/sweep": 1,
      },
    });

    expect(await runSaisonSweep()).toStrictEqual({
      count: { bewerbung_failed: 7, registrierung_failed: 8, saison_failed: 4 },
      open: 19,
      error: undefined,
    });
  });
});

describe("a half that fails", () => {
  /* The pass's one end where nothing can be swept: the scheduler files it under the job's name. */
  it("rejects where the season list cannot be read", async () => {
    answers.set(LISTING, () => refusal(undefined, { status: 503 }));

    const error: unknown = await runSaisonSweep().catch((rejection: unknown) => rejection);

    expect(error, "the pass dropped the listing's failure").toBeInstanceOf(APIBadStatusError);
    expect((error as APIBadStatusError).statusCode).toBe(503);
    expect(order()).toStrictEqual([LISTING]);
  });

  /* Each half apart: a throw in the application's clocks skips no registration, whose rows hold a minor's name,
     address and birthdate. The line's `trace_id` is what joins a half's failure line to the backend's own for that
     request. */
  it("runs every other half, files a line naming the half and the season, and then fails", async () => {
    seasons(["2526", "2627"], { fails: ["POST /bewerbungen/saisons/2526/sweep", "POST /registrierungen/saisons/2627/sweep"] });

    expect((await runSaisonSweep()).error).toBeInstanceOf(AggregateError);

    expect(order()).toStrictEqual([
      LISTING,
      "POST /bewerbungen/saisons/2526/sweep",
      "POST /registrierungen/saisons/2526/sweep",
      "POST /saisons/2526/sweep",
      "POST /bewerbungen/saisons/2627/sweep",
      "POST /registrierungen/saisons/2627/sweep",
      "POST /saisons/2627/sweep",
    ]);
    const failures = log
      .lines()
      .filter(({ level }) => level === "ERROR")
      .map(({ message, fields: { name, saison_id }, traceId }) => ({ message, name, trace_id: traceId, saison_id }));
    expect(failures).toStrictEqual([
      {
        message: "bewerbung.sweep_failed",
        name: "APINetworkError",
        trace_id: traceOf("POST /bewerbungen/saisons/2526/sweep"),
        saison_id: "2526",
      },
      {
        message: "registrierung.sweep_failed",
        name: "APINetworkError",
        trace_id: traceOf("POST /registrierungen/saisons/2627/sweep"),
        saison_id: "2627",
      },
    ]);
    // Each request mints a trace of its own outside a request's scope, so the two lines carry two traces, neither the
    // `SYSTEM` a line falls back to.
    expect(new Set(failures.map(({ trace_id }) => trace_id)).size).toBe(2);
  });
});
