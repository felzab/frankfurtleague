import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

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
/** Every load of `fl_frontend/src/core/mail.ts`, the one module reaching the mail provider, which the sweep never reaches. */
const mailerLoads: string[] = [];

// Watched rather than doubled: a suite's own double must be served
// (`fl_frontend/src/core/exportingModule.ts :: Registration`), and any load is the regression, at import or at a send.
registerHooks({
  load(url, context, nextLoad) {
    if (url.endsWith("/src/core/mail.ts")) mailerLoads.push(url);
    return nextLoad(url, context);
  },
});

/** Which of `identifiers` the doubled read answers unreferenced, handed the batch alone or an address re-asked alone. */
let referenzen: (identifiers: readonly string[]) => readonly string[] = () => [];

// Replaced at the module boundary: the real client reaches a backend no test process runs.
const calls = doubleApiClient((call, schema) => {
  const { identifiers } = JSON.parse(call.body ?? "{}") as { identifiers: string[] };
  // Parsed by the mirror the real client parses with, so an answer this file composes cannot drift.
  return schema.parse({ acknowledged: 1, unreferenziert: referenzen(identifiers) });
});

const record =
  (level: string) =>
  (event: string, ...rest: unknown[]): void => {
    const [error, fields] = level === "ERROR" ? rest : [undefined, rest[0]];
    lines.push({ level, event, error: error instanceof Error ? error.message : error, fields });
  };

registerDoubles({
  modules: {
    // The store's two calls, whose rows `fl_frontend/src/core/auth.db.test.ts` holds; the sweep decides only which to make.
    "core/auth.ts": {
      listAccounts: () => listing(),
      deleteAccountFor: (identifier: string) => {
        deleteCalls.push(identifier);
        const outcome = deleteOutcomes.get(identifier);
        // A failure on this path names the address it was about, as a driver's or the store's would.
        if (outcome === "throws") return Promise.reject(new TypeError(`no transaction for ${identifier}`));
        return Promise.resolve(outcome !== "gone");
      },
    },
    "core/logging.ts": { logger: { debug: record("DEBUG"), info: record("INFO"), warn: record("WARN"), error: record("ERROR") } },
  },
});

const { runKontoSweep } = await import("./sweep.ts");
const { REFERENZEN_ADRESSEN_MAX } = await import("./constants.ts");
const { FLReferenzenPayloadSchema } = await import("./schemas.ts");

/** The addresses one call asked about. */
const askedIn = (call: ApiCall): string[] => FLReferenzenPayloadSchema.parse(JSON.parse(call.body ?? "{}")).identifiers;

/** `count` distinct addresses, as the store folds them. */
const adressen = (count: number, prefix = "person"): string[] => Array.from({ length: count }, (_, at) => `${prefix}${String(at)}@schule.de`);

/** Every address but those in `referenced` answered unreferenced, wherever it is asked. */
const unreferencedBut =
  (...referenced: string[]) =>
  (identifiers: readonly string[]): readonly string[] =>
    identifiers.filter((identifier) => !referenced.includes(identifier));

const failures = (): Line[] => lines.filter(({ level }) => level === "ERROR");

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

    assert.deepEqual(deleteCalls, ["erika@schule.de"]);
  });

  /* The record can arrive between the batch's answer and the delete: asked again alone, just before
     it, the race narrows to the seconds between that answer and the delete. */
  it("keeps an account the batch answered unreferenced and the second ask no longer does", async () => {
    accounts = ["erika@schule.de", "neu@schule.de"];
    referenzen = (identifiers) => (identifiers.length > 1 ? identifiers : unreferencedBut("neu@schule.de")(identifiers));

    await runKontoSweep();

    assert.deepEqual(deleteCalls, ["erika@schule.de"]);
    assert.deepEqual(
      calls.slice(1).map(askedIn),
      [["erika@schule.de"], ["neu@schule.de"]],
      "each unreferenced address is asked again, alone, before its delete",
    );
  });
});

describe("the batches a pass asks in", () => {
  /* The read refuses a batch past its ceiling whole, every pass alike, so a pass sending one would
     delete nothing ever after behind one failure line an hour. */
  it("asks one more account than the ceiling in two batches, none past it, each address once", async () => {
    accounts = adressen(REFERENZEN_ADRESSEN_MAX + 1);

    await runKontoSweep();

    const asked = calls.map(askedIn);
    assert.deepEqual(
      asked.map((batch) => batch.length),
      [REFERENZEN_ADRESSEN_MAX, 1],
    );
    assert.deepEqual(asked.flat(), accounts, "an address was asked twice, or not at all");
  });

  // An empty batch is refused whole too.
  it("asks the backend nothing for an empty store, and still writes its completion line", async () => {
    await runKontoSweep();

    assert.deepEqual(calls, []);
    assert.deepEqual(lines.at(-1)?.event, "konto.sweep_completed");
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

    await runKontoSweep();

    assert.deepEqual(deleteCalls, zweiter);
    assert.deepEqual(
      failures().map(({ event, fields }) => ({ event, fields })),
      [{ event: "konto.referenzen_failed", fields: { error_code: "FE-SWEEP-003", name: "TypeError", anzahl: REFERENZEN_ADRESSEN_MAX } }],
    );
  });

  it("deletes the rest past one throwing delete, logging that one by the error's name alone", async () => {
    accounts = ["a@schule.de", "b@schule.de", "c@schule.de"];
    referenzen = (identifiers) => identifiers;
    deleteOutcomes.set("b@schule.de", "throws");

    await runKontoSweep();

    assert.deepEqual(deleteCalls, accounts);
    assert.deepEqual(failures(), [
      {
        level: "ERROR",
        event: "konto.delete_failed",
        error: undefined,
        fields: { error_code: "FE-SWEEP-003", name: "TypeError", anzahl: undefined },
      },
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

    assert.deepEqual(
      lines.map(({ event }) => event),
      ["konto.referenzen_failed", "konto.delete_failed", "konto.sweep_completed"],
    );
    assert.ok(!JSON.stringify(lines).includes("@"), "a line carries an address");
    assert.deepEqual(mailerLoads, [], "the sweep reached the mailer");
  });
});

describe("one pass at a time", () => {
  /* A pass slower than the hour would otherwise ask and delete beside itself over the same accounts. */
  it("skips a tick arriving while a pass runs, with one line and no call", async () => {
    // Every list held open is released, so a second pass that ran beside the first fails the case
    // rather than leaving it waiting on a list nobody answers.
    const held: ((value: readonly string[]) => void)[] = [];
    let lists = 0;
    listing = () => {
      lists += 1;
      return new Promise((resolve) => void held.push(resolve));
    };

    const first = runKontoSweep();
    const second = runKontoSweep();
    for (const release of held) release([]);
    await Promise.all([first, second]);

    assert.equal(lists, 1, "the second tick listed the store beside the running pass");
    assert.deepEqual(
      lines.map(({ level, event }) => `${level} ${event}`),
      ["INFO konto.sweep_skipped", "INFO konto.sweep_completed"],
    );
  });
});

describe("the line a completed pass writes", () => {
  /* Nothing is stored, so this line is the whole answer to whether the sweep runs and what it did. */
  it("counts what it listed, what was answered unreferenced, deleted, already gone and failed", async () => {
    accounts = ["geloescht@schule.de", "fort@schule.de", "referenziert@schule.de", "neu@schule.de", "fehler@schule.de"];
    referenzen = (identifiers) =>
      identifiers.length > 1 ? unreferencedBut("referenziert@schule.de")(identifiers) : unreferencedBut("neu@schule.de")(identifiers);
    deleteOutcomes.set("fort@schule.de", "gone");
    deleteOutcomes.set("fehler@schule.de", "throws");

    await runKontoSweep();

    assert.deepEqual(lines.at(-1), {
      level: "INFO",
      event: "konto.sweep_completed",
      error: undefined,
      fields: { gelistet: 5, unreferenziert: 4, geloescht: 1, bereits_geloescht: 1, fehlgeschlagen: 1 },
    });
  });
});
