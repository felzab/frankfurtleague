import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { APIBadStatusError, APINetworkError } from "@/core/errors.ts";

/** One backend call, in the order it ran, or the address changes' half, which is its own suite's. */
type SweepEvent = { kind: "api"; endpoint: string; method: string } | { kind: "adresswechsel" };

const events: SweepEvent[] = [];

/** Every line as it was written, its fields whole: what a half's failure carries. */
const lines: { level: "info" | "warn" | "error"; event: string; fields: unknown }[] = [];

let apiAnswer: (call: { endpoint: string; method: string }) => unknown = () => ({});

/** What the address changes' half did, its remainder `verbleibend`. */
const adressen = (verbleibend = 0) => ({ entfernt: 0, wirksam: 0, verworfen: 0, verbleibend: verbleibend });

/** The address changes' half, answered here and held in `fl_frontend/src/features/adresswechsel/sweep.test.ts`. */
let adresswechselAnswer: () => Promise<ReturnType<typeof adressen>> = () => Promise.resolve(adressen());

// Replaced at the module boundary rather than the sweep being reshaped to admit a seam: the real
// client reaches a backend no test process runs.
doubleApiClient(({ endpoint: requested, method }) => {
  const endpoint = new URL(requested, "http://backend").pathname;
  const call = { endpoint: endpoint, method: method ?? "GET" };
  events.push({ kind: "api", ...call });
  return apiAnswer(call);
});

vi.doMock("@/features/adresswechsel/sweep.ts", () => ({
  sweepAdresswechsel: () => {
    events.push({ kind: "adresswechsel" });
    return adresswechselAnswer();
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
const bewerbungPass = (saisonId: string, fehlgeschlagen = 0) => ({
  saison_id: saisonId,
  erinnert: 0,
  geloescht: 0,
  abgelehnte_geloescht: 0,
  angenommene_geloescht: 0,
  ohne_entscheidung_geloescht: 0,
  kontaktbloecke_geleert: 0,
  redigierte_aktionen: 0,
  fehlgeschlagen: fehlgeschlagen,
});
const registrierungPass = (saisonId: string, fehlgeschlagen = 0) => ({
  saison_id: saisonId,
  erinnert: 0,
  geloescht_unbestaetigt: 0,
  geloescht_ohne_entscheidung: 0,
  geloescht_abgelehnt: 0,
  redigierte_aktionen: 0,
  fehlgeschlagen: fehlgeschlagen,
});

/**
 * Every season answered, each half's passed-over rows as `uebergangen` names them, and a half `scheitert` names
 * thrown.
 */
function seasons(
  saisonIds: string[],
  { uebergangen = {}, scheitert = [] }: { uebergangen?: Record<string, number>; scheitert?: string[] } = {},
): void {
  apiAnswer = ({ endpoint, method }) => {
    if (method === "GET") return { saison_ids: saisonIds };
    if (scheitert.includes(endpoint)) throw new Error(`the backend refused ${endpoint}`);
    const saisonId = saisonOf(endpoint);
    return endpoint.startsWith("/registrierungen/")
      ? registrierungPass(saisonId, uebergangen[endpoint] ?? 0)
      : bewerbungPass(saisonId, uebergangen[endpoint] ?? 0);
  };
}

const order = (): string[] => events.map((event) => (event.kind === "api" ? event.endpoint : "adresswechsel"));

const failures = (): unknown[] => lines.filter(({ level }) => level === "error").map(({ event, fields }) => ({ event, fields }));

beforeEach(() => {
  events.length = 0;
  lines.length = 0;
  seasons([]);
  adresswechselAnswer = () => Promise.resolve(adressen());
});

describe("one pass of the applications' job", () => {
  it("runs each season's two halves in turn, then the address changes' half", async () => {
    seasons(["2526", "2627"]);

    await runBewerbungSweep();

    expect(order()).toStrictEqual([
      "/bewerbungen/sweep",
      "/bewerbungen/sweep/2526",
      "/registrierungen/sweep/2526",
      "/bewerbungen/sweep/2627",
      "/registrierungen/sweep/2627",
      "adresswechsel",
    ]);
  });

  /* What the heartbeat names: the rows a pass left owed, which only a sum over every season and both halves tells
     apart from a healthy pass. */
  it("leaves every row the halves passed over and every lapsed change the address half left, each half counted", async () => {
    seasons(["2526", "2627"], {
      uebergangen: { "/bewerbungen/sweep/2526": 1, "/bewerbungen/sweep/2627": 6, "/registrierungen/sweep/2627": 8 },
    });
    adresswechselAnswer = () => Promise.resolve({ ...adressen(2), entfernt: 5 });

    expect(await runBewerbungSweep()).toStrictEqual({
      count: {
        bewerbung_fehlgeschlagen: 7,
        registrierung_fehlgeschlagen: 8,
        adresswechsel_entfernt: 5,
        adresswechsel_wirksam: 0,
        adresswechsel_verworfen: 0,
        adresswechsel_verbleibend: 2,
      },
      open: 17,
      error: undefined,
    });
  });

  it("leaves none where nothing was passed over", async () => {
    seasons(["2627"]);

    expect((await runBewerbungSweep()).open).toBe(0);
  });
});

describe("a half that fails", () => {
  /* Each half apart: a throw in the application's clocks skips no registration, whose rows hold a minor's name,
     address and birthdate. */
  it("runs every other half, files a line naming the half and the season, and then fails", async () => {
    seasons(["2526", "2627"], { scheitert: ["/bewerbungen/sweep/2526", "/registrierungen/sweep/2627"] });

    expect((await runBewerbungSweep()).error).toBeInstanceOf(AggregateError);

    expect(order()).toStrictEqual([
      "/bewerbungen/sweep",
      "/bewerbungen/sweep/2526",
      "/registrierungen/sweep/2526",
      "/bewerbungen/sweep/2627",
      "/registrierungen/sweep/2627",
      "adresswechsel",
    ]);
    expect(failures()).toStrictEqual([
      { event: "bewerbung.sweep_failed", fields: { name: "Error", saison_id: "2526" } },
      { event: "registrierung.sweep_failed", fields: { name: "Error", saison_id: "2627" } },
    ]);
  });

  /* The pass's one end where nothing can be swept: the scheduler files it under the job's name, and the address
     changes are ended all the same. */
  it("fails where the season list cannot be read, the address half still running", async () => {
    apiAnswer = () => {
      throw new Error("the backend refused the season list");
    };

    expect((await runBewerbungSweep()).error).toStrictEqual(new Error("the backend refused the season list"));

    expect(order()).toStrictEqual(["/bewerbungen/sweep", "adresswechsel"]);
  });

  it("rejects where the address half rejects, after every season was swept", async () => {
    seasons(["2627"]);
    adresswechselAnswer = () => Promise.reject(new Error("the lapsed addresses answered nothing"));

    await expect(runBewerbungSweep()).rejects.toThrow("the lapsed addresses answered nothing");

    expect(order()).toStrictEqual(["/bewerbungen/sweep", "/bewerbungen/sweep/2627", "/registrierungen/sweep/2627", "adresswechsel"]);
  });

  it("keeps the counts of the halves that answered where another throws", async () => {
    seasons(["2526", "2627"], { uebergangen: { "/bewerbungen/sweep/2526": 3 }, scheitert: ["/bewerbungen/sweep/2627"] });

    const lauf = await runBewerbungSweep();

    expect([lauf.count.bewerbung_fehlgeschlagen, lauf.open, lauf.error instanceof AggregateError]).toStrictEqual([3, 3, true]);
  });
});

describe("the line a failed call files", () => {
  /* A refusal and a crash carry the same name: the status and code tell them apart, and the trace joins
     the line to the backend's own for that request. */
  it("names a refused call's status, code and trace", async () => {
    seasons(["2627"]);
    const answered = apiAnswer;
    apiAnswer = (call) => {
      if (call.endpoint !== "/bewerbungen/sweep/2627") return answered(call);
      throw new APIBadStatusError({
        message: "The backend failed the request.",
        url: "http://backend:8000/api/v0/bewerbungen/sweep/2627",
        endpoint: "/bewerbungen/sweep/{saison_id}",
        method: "POST",
        readOnly: false,
        statusCode: 500,
        serverErrorCode: "database_failed",
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      });
    };

    expect((await runBewerbungSweep()).error).toBeInstanceOf(AggregateError);

    expect(failures()).toStrictEqual([
      {
        event: "bewerbung.sweep_failed",
        fields: {
          name: "APIBadStatusError",
          status: 500,
          server_error_code: "database_failed",
          trace_id: "4bf92f3577b34da6a3ce929d0e0e4736",
          saison_id: "2627",
        },
      },
    ]);
  });

  /* No status: the backend never answered, so the trace is all that finds the request in its log, if it
     arrived there at all. */
  it("names an unanswered call's trace", async () => {
    seasons(["2627"]);
    const answered = apiAnswer;
    apiAnswer = (call) => {
      if (call.endpoint !== "/registrierungen/sweep/2627") return answered(call);
      throw new APINetworkError({
        message: "The backend did not answer.",
        url: "http://backend:8000/api/v0/registrierungen/sweep/2627",
        method: "POST",
        readOnly: false,
        traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
        isTimeout: true,
      });
    };

    expect((await runBewerbungSweep()).error).toBeInstanceOf(AggregateError);

    expect(failures()).toStrictEqual([
      {
        event: "registrierung.sweep_failed",
        fields: { name: "APINetworkError", trace_id: "4bf92f3577b34da6a3ce929d0e0e4736", saison_id: "2627" },
      },
    ]);
  });
});
