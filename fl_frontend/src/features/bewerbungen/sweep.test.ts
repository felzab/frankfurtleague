import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APINetworkError } from "@/core/errors.ts";

/** One backend call, in the order it ran, or the address changes' half, which is its own suite's. */
type SweepEvent = { kind: "api"; endpoint: string; method: string } | { kind: "address_change" };

const events: SweepEvent[] = [];

/** Every line as it was written, its fields whole: what a half's failure carries. */
const lines: { level: "info" | "warn" | "error"; event: string; fields: unknown }[] = [];

let apiAnswer: (call: { endpoint: string; method: string }) => unknown = () => ({});

/** What the address changes' half did, its remainder `remaining`. */
const adressen = (remaining = 0) => ({ removed: 0, effective: 0, discarded: 0, remaining });

/** The address changes' half, answered here and held in `fl_frontend/src/features/address-change/sweep.test.ts`. */
let addressChangeAnswer: () => Promise<ReturnType<typeof adressen>> = () => Promise.resolve(adressen());

// Replaced at the module boundary rather than the sweep being reshaped to admit a seam: the real
// client reaches a backend no test process runs.
doubleApiClient(({ endpoint: requested, method }) => {
  const endpoint = new URL(requested, "http://backend").pathname;
  const call = { endpoint, method: method ?? "GET" };
  events.push({ kind: "api", ...call });
  return apiAnswer(call);
});

vi.doMock("@/features/address-change/sweep.ts", () => ({
  sweepAddressChange: () => {
    events.push({ kind: "address_change" });
    return addressChangeAnswer();
  },
}));

vi.doMock("@/core/logging.ts", () => ({
  logger: {
    info: (event: string, fields?: unknown) => void lines.push({ level: "info", event, fields }),
    warn: (event: string, fields?: unknown) => void lines.push({ level: "warn", event, fields }),
    error: (event: string, _message: unknown, fields?: unknown) => void lines.push({ level: "error", event, fields }),
  },
}));

const { runBewerbungSweep } = await import("./sweep.ts");

/** The season a call addresses, which the contract puts in the path rather than in a parameter. */
const saisonOf = (endpoint: string): string => endpoint.split("/")[3] ?? "";

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

/** The trace a failed half's call was sent under, which its failure line carries to join the backend's. */
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

/**
 * Every season answered, each half's passed-over rows as `passedOver` names them, and a half `fails` names
 * unanswered.
 */
function seasons(saisonIds: string[], { passedOver = {}, fails = [] }: { passedOver?: Record<string, number>; fails?: string[] } = {}): void {
  apiAnswer = ({ endpoint, method }) => {
    if (method === "GET") return { saison_ids: saisonIds };
    if (fails.includes(endpoint))
      throw new APINetworkError({
        message: "The backend did not answer.",
        traceId: TRACE_ID,
      });
    if (endpoint === "/schiedsrichter/sweep") return { erased: 0, failed: passedOver[endpoint] ?? 0 };
    const saisonId = saisonOf(endpoint);
    return endpoint.startsWith("/registrierungen/")
      ? registrierungPass(saisonId, passedOver[endpoint] ?? 0)
      : bewerbungPass(saisonId, passedOver[endpoint] ?? 0);
  };
}

const order = (): string[] => events.map((event) => (event.kind === "api" ? event.endpoint : "address_change"));

const failures = (): unknown[] => lines.filter(({ level }) => level === "error").map(({ event, fields }) => ({ event, fields }));

beforeEach(() => {
  events.length = 0;
  lines.length = 0;
  seasons([]);
  addressChangeAnswer = () => Promise.resolve(adressen());
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
    });
    addressChangeAnswer = () => Promise.resolve({ ...adressen(2), removed: 5 });

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
  /* Each half apart: a throw in the application's clocks skips no registration, whose rows hold a minor's name,
     address and birthdate. */
  it("runs every other half, files a line naming the half and the season, and then fails", async () => {
    seasons(["2526", "2627"], { fails: ["/bewerbungen/sweep/2526", "/registrierungen/sweep/2627"] });

    expect((await runBewerbungSweep()).error).toBeInstanceOf(AggregateError);

    expect(order()).toStrictEqual([
      "/bewerbungen/sweep",
      "/bewerbungen/sweep/2526",
      "/registrierungen/sweep/2526",
      "/bewerbungen/sweep/2627",
      "/registrierungen/sweep/2627",
      "address_change",
      "/schiedsrichter/sweep",
    ]);
    expect(failures()).toStrictEqual([
      { event: "bewerbung.sweep_failed", fields: { name: "APINetworkError", trace_id: TRACE_ID, saison_id: "2526" } },
      { event: "registrierung.sweep_failed", fields: { name: "APINetworkError", trace_id: TRACE_ID, saison_id: "2627" } },
    ]);
  });

  /* The pass's one end where nothing can be swept: the scheduler files it under the job's name, and the address
     changes and the referee entries are ended all the same. */
  it("fails where the season list cannot be read, the address half and the referee clock still running", async () => {
    const answered = apiAnswer;
    apiAnswer = (call) => {
      if (call.method !== "GET") return answered(call);
      throw new Error("the backend refused the season list");
    };

    expect((await runBewerbungSweep()).error).toStrictEqual(new Error("the backend refused the season list"));

    expect(order()).toStrictEqual(["/bewerbungen/sweep", "address_change", "/schiedsrichter/sweep"]);
  });

  it("rejects where the address half rejects, after every season was swept", async () => {
    seasons(["2627"]);
    addressChangeAnswer = () => Promise.reject(new Error("the lapsed addresses answered nothing"));

    await expect(runBewerbungSweep()).rejects.toThrow("the lapsed addresses answered nothing");

    expect(order()).toStrictEqual(["/bewerbungen/sweep", "/bewerbungen/sweep/2627", "/registrierungen/sweep/2627", "address_change"]);
  });
});
