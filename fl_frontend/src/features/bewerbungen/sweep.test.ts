import { networkFailure, refusal, serveBackend } from "@/test-support/backend.ts";
import { beforeEach, describe, expect, it } from "vitest";

import { APIBadStatusError, APINetworkError } from "@/core/errors.ts";

import type { FLAddressChangeSweepResponse } from "@/core/generated/client/types.ts";

/** One season half's answer, the rows it passed over counted. */
const bewerbungPass = (saisonId: string, failed = 0) => ({
  saison_id: saisonId,
  reminded: 0,
  erased: 0,
  erased_declined: 0,
  erased_accepted: 0,
  erased_without_decision: 0,
  kontakt_blocks_emptied: 0,
  failed,
});
const registrierungPass = (saisonId: string, failed = 0) => ({
  saison_id: saisonId,
  reminded: 0,
  erased_unconfirmed: 0,
  erased_without_decision: 0,
  erased_declined: 0,
  failed,
});

/** What the address changes' one call answers, its remainder `remaining`, naming no place, so the half's pass ends on it. */
const adressen = (remaining = 0): FLAddressChangeSweepResponse => ({ removed: 0, effective: 0, discarded: 0, remaining, after: null });

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
    addressChange = adressen(),
    fails = [],
  }: { passedOver?: Record<string, number>; addressChange?: unknown; fails?: string[] } = {},
): void {
  answers = new Map<string, () => unknown>([
    [LISTING, () => ({ saison_ids: saisonIds })],
    ...saisonIds.flatMap((saisonId): [string, () => unknown][] => [
      [`POST /bewerbungen/sweep/${saisonId}`, () => bewerbungPass(saisonId, passedOver[`/bewerbungen/sweep/${saisonId}`])],
      [`POST /registrierungen/sweep/${saisonId}`, () => registrierungPass(saisonId, passedOver[`/registrierungen/sweep/${saisonId}`])],
    ]),
    ["POST /address_change/sweep", () => addressChange],
    ["GET /address_change/sweep/moves", () => ({ moves: [] })],
    [REFEREE_CLOCK, () => ({ erased: 0, failed: passedOver["/schiedsrichter/sweep"] ?? 0 })],
  ]);
  for (const failing of fails) answers.set(failing, networkFailure);
}

const backend = serveBackend(({ method, path }) => answers.get(`${method} ${path}`)?.());

const { runBewerbungSweep } = await import("./sweep.ts");

/** Every request in the order sent. */
const order = (): string[] => backend.sent.map(({ method, path }) => `${method} ${path}`);

beforeEach(() => {
  seasons([]);
});

describe("one pass of the applications' job", () => {
  /* What the heartbeat names: the rows a pass left owed, which only a sum over every season and both halves tells
     apart from a healthy pass. */
  it("leaves every row the halves passed over and every lapsed change the address half left, each half counted", async () => {
    seasons(["2526", "2627"], {
      passedOver: {
        "/bewerbungen/sweep/2526": 1,
        "/bewerbungen/sweep/2627": 6,
        "/registrierungen/sweep/2627": 8,
        "/schiedsrichter/sweep": 1,
      },
      addressChange: { ...adressen(2), removed: 5 },
    });

    expect(await runBewerbungSweep()).toStrictEqual({
      count: {
        bewerbung_failed: 7,
        registrierung_failed: 8,
        address_change_removed: 5,
        address_change_effective: 0,
        address_change_discarded: 0,
        address_change_remaining: 2,
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

  it("rejects where the address half rejects, after every season was swept", async () => {
    seasons(["2627"], { fails: ["POST /address_change/sweep"] });

    await expect(runBewerbungSweep()).rejects.toThrow(APINetworkError);

    expect(order()).toStrictEqual([LISTING, "POST /bewerbungen/sweep/2627", "POST /registrierungen/sweep/2627", "POST /address_change/sweep"]);
  });
});
