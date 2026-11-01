import { doubleApiClient } from "@/test-support/apiClientDouble.ts";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import { APIBadStatusError, APINetworkError } from "@/core/errors.ts";

import type { FLReferencesPayload, FLReferencesResponse } from "@/core/generated/client/types.ts";
import type { ApiCall } from "@/test-support/apiClientDouble.ts";

/** One line a pass wrote, as the logger was handed it: an error's message is kept, since that is where an address would hide. */
type Line = { level: string; event: string; error: unknown; fields: unknown };

const lines: Line[] = [];

/** The sign-in store's accounts, as `listAccounts` answers them; a case sets them. */
let accounts: readonly string[] = [];
/** What the store's list does: answers `accounts` unless a case holds it open. */
let listing: () => Promise<readonly string[]> = () => Promise.resolve(accounts);
/** Every address `deleteAccountFor` was handed, in order. */
const deleteCalls: string[] = [];
/** Per address, what `deleteAccountFor` does where it was not simply there to delete. */
const deleteOutcomes = new Map<string, "gone" | "throws">();
/** Every drain the sweep started, the one way a mail reaches the provider, which the sweep never starts. */
const drains: string[] = [];

// Doubled at the drain alone, the module standing: the client every slice sends through loads it, so a load is no send.
vi.doMock("@/core/mail.ts", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  drainOutbox: () => {
    drains.push("drain");
    return Promise.resolve();
  },
}));

/** Which of `identifiers` the doubled read answers unreferenced, handed the batch alone or an address re-asked alone. */
let referenzen: (identifiers: readonly string[]) => readonly string[] = () => [];

// Replaced at the module boundary: the real client reaches a backend no test process runs.
const calls = doubleApiClient((call) => {
  const { identifiers } = JSON.parse(call.body ?? "{}") as FLReferencesPayload;
  return { unreferenced: [...referenzen(identifiers)] } satisfies FLReferencesResponse;
});

const record =
  (level: string) =>
  (event: string, ...rest: unknown[]): void => {
    const [error, fields] = level === "ERROR" ? rest : [undefined, rest[0]];
    lines.push({ level, event, error: error instanceof Error ? error.message : error, fields });
  };

vi.doMock("@/core/auth.ts", () => ({
  listAccounts: () => listing(),
  deleteAccountFor: (identifier: string) => {
    deleteCalls.push(identifier);
    const outcome = deleteOutcomes.get(identifier);
    // A failure on this path names the address it was about, as a driver's or the store's would.
    if (outcome === "throws") return Promise.reject(new TypeError(`no transaction for ${identifier}`));
    return Promise.resolve(outcome !== "gone");
  },
}));
vi.doMock("@/core/logging.ts", () => ({
  logger: { debug: record("DEBUG"), info: record("INFO"), warn: record("WARN"), error: record("ERROR") },
}));

const { runKontoSweep } = await import("./sweep.ts");
const { REFERENZEN_ADRESSEN_MAX } = await import("./constants.ts");

/** The addresses one call asked about. */
const askedIn = (call: ApiCall): string[] => (JSON.parse(call.body ?? "{}") as FLReferencesPayload).identifiers;

/** `count` distinct addresses, as the store folds them. */
const adressen = (count: number, prefix = "person"): string[] => Array.from({ length: count }, (_, at) => `${prefix}${String(at)}@schule.de`);

/** Every address but those in `referenced` answered unreferenced, wherever it is asked. */
const unreferencedBut =
  (...referenced: string[]) =>
  (identifiers: readonly string[]): readonly string[] =>
    identifiers.filter((identifier) => !referenced.includes(identifier));

const failures = (): Line[] => lines.filter(({ level }) => level === "ERROR");

/** The trace a refused call was sent under, which its failure line carries to join the backend's. */
const TRACE_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

beforeEach(() => {
  calls.length = 0;
  lines.length = 0;
  deleteCalls.length = 0;
  deleteOutcomes.clear();
  accounts = [];
  listing = () => Promise.resolve(accounts);
  referenzen = () => [];
});

describe("which accounts a pass deletes", () => {
  it("deletes an account answered unreferenced in the batch and again alone, and never one the read does not answer", async () => {
    accounts = ["erika@schule.de", "max@schule.de"];
    referenzen = unreferencedBut("max@schule.de");

    await runKontoSweep();

    expect(deleteCalls).toStrictEqual(["erika@schule.de"]);
  });

  /* The record can arrive between the batch's answer and the delete: asked again alone, just before
     it, the race narrows to the seconds between that answer and the delete. */
  it("keeps an account the batch answered unreferenced and the second ask no longer does", async () => {
    accounts = ["erika@schule.de", "neu@schule.de"];
    referenzen = (identifiers) => (identifiers.length > 1 ? identifiers : unreferencedBut("neu@schule.de")(identifiers));

    await runKontoSweep();

    expect(deleteCalls).toStrictEqual(["erika@schule.de"]);
    expect(calls.slice(1).map(askedIn), "each unreferenced address is asked again, alone, before its delete").toStrictEqual([
      ["erika@schule.de"],
      ["neu@schule.de"],
    ]);
  });
});

describe("the batches a pass asks in", () => {
  /* The read refuses a batch past its ceiling whole, every pass alike, so a pass sending one would
     delete nothing ever after behind one failure line an hour. */
  it("asks one more account than the ceiling in two batches, none past it, each address once", async () => {
    accounts = adressen(REFERENZEN_ADRESSEN_MAX + 1);

    await runKontoSweep();

    const asked = calls.map(askedIn);
    expect(asked.map((batch) => batch.length)).toStrictEqual([REFERENZEN_ADRESSEN_MAX, 1]);
    expect(asked.flat(), "an address was asked twice, or not at all").toStrictEqual(accounts);
  });

  // An empty batch is refused whole too.
  it("asks the backend nothing for an empty store", async () => {
    await runKontoSweep();

    expect(calls).toStrictEqual([]);
  });
});

describe("a pass meeting a failure", () => {
  it("deletes nothing a failed batch asked about, still deletes from the next, and writes one failure line", async () => {
    accounts = adressen(REFERENZEN_ADRESSEN_MAX + 2);
    const zweiter = accounts.slice(REFERENZEN_ADRESSEN_MAX);
    referenzen = (identifiers) => {
      if (identifiers.length === REFERENZEN_ADRESSEN_MAX) throw new TypeError("fetch failed");
      return identifiers;
    };

    // The batch it could not judge is what the pass left, which the heartbeat names.
    expect((await runKontoSweep()).open).toBe(REFERENZEN_ADRESSEN_MAX);

    expect(deleteCalls).toStrictEqual(zweiter);
    expect(failures().map(({ event, fields }) => ({ event, fields }))).toStrictEqual([
      { event: "account.references_failed", fields: { name: "TypeError", anzahl: REFERENZEN_ADRESSEN_MAX } },
    ]);
  });

  it("deletes the rest past one throwing delete, logging that one by the error's name alone", async () => {
    accounts = ["a@schule.de", "b@schule.de", "c@schule.de"];
    referenzen = (identifiers) => identifiers;
    deleteOutcomes.set("b@schule.de", "throws");

    await runKontoSweep();

    expect(deleteCalls).toStrictEqual(accounts);
    expect(failures()).toStrictEqual([
      {
        level: "ERROR",
        event: "account.delete_failed",
        error: undefined,
        fields: { name: "TypeError", anzahl: undefined },
      },
    ]);
  });

  it("keeps an account whose second ask fails, and goes on to the next", async () => {
    accounts = ["a@schule.de", "b@schule.de", "c@schule.de"];
    referenzen = (identifiers) => {
      if (identifiers.length === 1 && identifiers[0] === "b@schule.de") throw new TypeError("fetch failed for b@schule.de");
      return identifiers;
    };

    await runKontoSweep();

    expect(deleteCalls).toStrictEqual(["a@schule.de", "c@schule.de"]);
    expect(failures().map(({ event, fields }) => ({ event, fields }))).toStrictEqual([
      { event: "account.delete_failed", fields: { name: "TypeError", anzahl: undefined } },
    ]);
  });

  /* The store unreachable: the scheduler's heartbeat names the job only where it rejects, and a completion line would
     say a pass ran that listed nothing. */
  it("rejects a pass whose store cannot be listed, asking the backend nothing and writing no line", async () => {
    listing = () => Promise.reject(new TypeError("no connection"));

    await expect(runKontoSweep()).rejects.toThrow(TypeError);

    expect(calls).toStrictEqual([]);
    expect(lines).toStrictEqual([]);
  });

  /* The backend refuses the read whole where the grants it reads hold no live owner: an empty or wrong
     database would otherwise answer every address unreferenced, twice. */
  it("deletes nothing the backend's fail-safe refuses, naming the refusal's status, code and trace", async () => {
    accounts = ["a@schule.de", "b@schule.de"];
    referenzen = () => {
      throw new APIBadStatusError({
        message: "The backend refused the request.",
        url: "http://backend:8000/api/v0/identity/references",
        endpoint: "/identity/references",
        method: "POST",
        readOnly: true,
        statusCode: 409,
        serverErrorCode: "no_owner",
        traceId: TRACE_ID,
      });
    };

    await runKontoSweep();

    expect(deleteCalls).toStrictEqual([]);
    expect(failures().map(({ event, fields }) => ({ event, fields }))).toStrictEqual([
      {
        event: "account.references_failed",
        fields: {
          name: "APIBadStatusError",
          status: 409,
          server_error_code: "no_owner",
          trace_id: TRACE_ID,
          anzahl: 2,
        },
      },
    ]);
  });

  /* No status: the backend never answered, so the trace is all that finds the request in its log, if it
     arrived there at all. */
  it("names an unanswered call's trace on its failure line", async () => {
    accounts = ["a@schule.de"];
    referenzen = () => {
      throw new APINetworkError({
        message: "The backend did not answer.",
        url: "http://backend:8000/api/v0/identity/references",
        method: "POST",
        readOnly: true,
        traceId: TRACE_ID,
        isTimeout: true,
      });
    };

    await runKontoSweep();

    expect(deleteCalls).toStrictEqual([]);
    expect(failures().map(({ event, fields }) => ({ event, fields }))).toStrictEqual([
      { event: "account.references_failed", fields: { name: "APINetworkError", trace_id: TRACE_ID, anzahl: 1 } },
    ]);
  });

  /* Every kind of line a pass writes, each failure carrying an address in its message the way a real
     one does: an account's address is what this pass must never put on a line, and it mails nobody. */
  it("names no address on any line, and mails nobody", async () => {
    accounts = [...adressen(REFERENZEN_ADRESSEN_MAX + 1, "batch"), "geloescht@schule.de", "fehler@schule.de"];
    referenzen = (identifiers) => {
      if (identifiers.length === REFERENZEN_ADRESSEN_MAX) throw new TypeError(`refused ${identifiers.join(", ")}`);
      return identifiers;
    };
    deleteOutcomes.set("fehler@schule.de", "throws");

    await runKontoSweep();

    expect(lines.map(({ event }) => event)).toStrictEqual(["account.references_failed", "account.delete_failed"]);
    assert.ok(!JSON.stringify(lines).includes("@"), "a line carries an address");
    // No mail owed through the sign-in library's route, and none sent: every other mail is a backend write's to owe.
    expect(
      calls.filter(({ endpoint }) => endpoint.startsWith("/outbox/")),
      "the sweep owed a mail",
    ).toStrictEqual([]);
    expect(drains, "the sweep drained the Postausgang").toStrictEqual([]);
  });
});

describe("what a completed pass answers", () => {
  /* Nothing is stored, so these counts on the scheduler's pass line are the whole record of what the sweep did, and
     the failed ones what the heartbeat names as left. */
  it("counts what was answered unreferenced, deleted, already gone and failed", async () => {
    accounts = ["geloescht@schule.de", "fort@schule.de", "referenziert@schule.de", "neu@schule.de", "fehler@schule.de"];
    referenzen = (identifiers) =>
      identifiers.length > 1 ? unreferencedBut("referenziert@schule.de")(identifiers) : unreferencedBut("neu@schule.de")(identifiers);
    deleteOutcomes.set("fort@schule.de", "gone");
    deleteOutcomes.set("fehler@schule.de", "throws");

    expect(await runKontoSweep()).toStrictEqual({
      count: { unreferenziert: 4, geloescht: 1, bereits_geloescht: 1, fehlgeschlagen: 1 },
      open: 1,
    });
  });
});
