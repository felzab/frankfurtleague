import { beforeEach, describe, expect, it } from "vitest";

import { APIBadStatusError, APINetworkError } from "@/core/errors";
import { networkFailure, refusal, serveBackend } from "@/test-support/backend";
import { captureLog } from "@/test-support/stdoutCapture";

import type { FLAddressChangeSweepResponse, FLBewerbungSweepResponse, FLRegistrierungSweepResponse } from "@/core/generated/client/types";

/** One season half's answer, the rows it passed over counted. */
const bewerbungPass = (failed = 0): FLBewerbungSweepResponse => ({ failed });
const registrierungPass = (failed = 0): FLRegistrierungSweepResponse => ({ failed });

/** What the address changes' one call answers, the changes it could not end counted. */
const addressChangeAnswer = (failed = 0): FLAddressChangeSweepResponse => ({ removed: 0, effective: 0, discarded: 0, failed });

/** The season listing, which the contract reads with a GET; every other call of the pass is a POST. */
const LISTING = "GET /bewerbungen/sweep";
const ADDRESS_HALF = ["POST /address_change/sweep", "GET /address_change/sweep/moves"];
const REFEREE_CLOCK = "POST /schiedsrichter/sweep";

/** Each request's answer, by its method and path; a request no entry names fails the case. */
let answers: Map<string, () => unknown>;

/**
 * Every season answered, each half's passed-over rows as `passedOver` names them, the address changes' call as
 * `addressChange` answers it, and each request `fails` names failed on the network.
 */
function seasons(
  saisonIds: string[],
  {
    passedOver = {},
    addressChange = addressChangeAnswer(),
    fails = [],
  }: { passedOver?: Record<string, number>; addressChange?: unknown; fails?: string[] } = {},
): void {
  answers = new Map<string, () => unknown>([
    [LISTING, () => ({ saison_ids: saisonIds })],
    ...saisonIds.flatMap((saisonId): [string, () => unknown][] => [
      [`POST /bewerbungen/saisons/${saisonId}/sweep`, () => bewerbungPass(passedOver[`/bewerbungen/saisons/${saisonId}/sweep`])],
      [`POST /registrierungen/saisons/${saisonId}/sweep`, () => registrierungPass(passedOver[`/registrierungen/saisons/${saisonId}/sweep`])],
    ]),
    ["POST /address_change/sweep", () => addressChange],
    ["GET /address_change/sweep/moves", () => ({ moves: [] })],
    [REFEREE_CLOCK, () => ({ erased: 0, failed: passedOver["/schiedsrichter/sweep"] ?? 0 })],
  ]);
  for (const failing of fails) answers.set(failing, networkFailure);
}

const backend = serveBackend(({ method, path }) => answers.get(`${method} ${path}`)?.());
/** Every line the real logger writes, read off standard output. */
const log = captureLog();

const { runBewerbungSweep } = await import("./sweep");

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

describe("one pass of the applications' job", () => {
  /* What the heartbeat names: the rows a pass left owed, which only a sum over every season and both halves tells
     apart from a healthy pass. */
  it("leaves every row the halves passed over and every change the address half could not end, each half counted", async () => {
    seasons(["2526", "2627"], {
      passedOver: {
        "/bewerbungen/saisons/2526/sweep": 1,
        "/bewerbungen/saisons/2627/sweep": 6,
        "/registrierungen/saisons/2627/sweep": 8,
        "/schiedsrichter/sweep": 1,
      },
      addressChange: { ...addressChangeAnswer(2), removed: 5 },
    });

    expect(await runBewerbungSweep()).toStrictEqual({
      count: {
        bewerbung_failed: 7,
        registrierung_failed: 8,
        address_change_removed: 5,
        address_change_effective: 0,
        address_change_discarded: 0,
        address_change_failed: 2,
        schiedsrichter_erased: 0,
        schiedsrichter_failed: 1,
      },
      open: 18,
      error: undefined,
    });
  });
});

describe("a half that fails", () => {
  /* The pass's one end where nothing can be swept: the scheduler files it under the job's name, and the address
     changes and the referee entries are ended all the same. */
  it("fails where the season list cannot be read, the address half and the referee clock still running", async () => {
    seasons([]);
    answers.set(LISTING, () => refusal(undefined, { status: 503 }));

    const { error } = await runBewerbungSweep();

    expect(error, "the pass dropped the listing's failure").toBeInstanceOf(APIBadStatusError);
    expect((error as APIBadStatusError).statusCode).toBe(503);
    expect(order()).toStrictEqual([LISTING, ...ADDRESS_HALF, REFEREE_CLOCK]);
  });

  /* Each half apart: a throw in the application's clocks skips no registration, whose rows hold a minor's name,
     address and birthdate. The line's `trace_id` is what joins a half's failure line to the backend's own for that
     request. */
  it("runs every other half, files a line naming the half and the season, and then fails", async () => {
    seasons(["2526", "2627"], { fails: ["POST /bewerbungen/saisons/2526/sweep", "POST /registrierungen/saisons/2627/sweep"] });

    expect((await runBewerbungSweep()).error).toBeInstanceOf(AggregateError);

    expect(order()).toStrictEqual([
      LISTING,
      "POST /bewerbungen/saisons/2526/sweep",
      "POST /registrierungen/saisons/2526/sweep",
      "POST /bewerbungen/saisons/2627/sweep",
      "POST /registrierungen/saisons/2627/sweep",
      ...ADDRESS_HALF,
      REFEREE_CLOCK,
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

  it("rejects where the address half rejects, after every season was swept", async () => {
    seasons(["2627"], { fails: ["POST /address_change/sweep"] });

    await expect(runBewerbungSweep()).rejects.toThrow(APINetworkError);

    expect(order()).toStrictEqual([
      LISTING,
      "POST /bewerbungen/saisons/2627/sweep",
      "POST /registrierungen/saisons/2627/sweep",
      "POST /address_change/sweep",
    ]);
  });
});
