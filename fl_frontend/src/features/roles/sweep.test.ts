import { insertOrderedAdapter, memoryStore, registerAuthDoubles } from "@/test-support/authDoubles.ts";
import { networkFailure, serveBackend } from "@/test-support/backend.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { beforeEach, describe, expect, it } from "vitest";

import type { FLReferencesPayload, FLReferencesResponse } from "@/core/generated/client/types.ts";
import type { MemoryDB } from "better-auth/adapters/memory";

/** The sign-in store under the real library: its own in-memory one, emptied before every case. */
const store = memoryStore("__flAccountSweepStore");

/** Set by a case to make the store fail the operations it names, as a store gone away or a failed transaction does. */
let failing: ((operation: string, query: { model?: string; where?: { field: string; value: unknown }[] }) => Error | undefined) | undefined;

/** The address an operation reads a user row by, where it reads one so. */
const addressOf = (query: { where?: { field: string; value: unknown }[] }): unknown =>
  query.where?.find(({ field }) => field === "email")?.value;

/**
 * The library's in-memory adapter, every operation on it and on each transaction it opens failing where `failing`
 * names it: the store's own failure, at the database's edge.
 */
const withFaults = <T extends object>(adapter: T): T =>
  new Proxy(adapter, {
    get: (target, key) => {
      const value: unknown = Reflect.get(target, key);
      if (typeof value !== "function" || typeof key !== "string") return value;
      return (...args: unknown[]) => {
        if (key === "transaction") {
          const [run] = args as [(held: object) => Promise<unknown>];
          return (value as (run: (held: object) => Promise<unknown>) => Promise<unknown>).call(target, (held) => run(withFaults(held)));
        }
        const fault = failing?.(key, (args[0] ?? {}) as Parameters<NonNullable<typeof failing>>[1]);
        if (fault !== undefined) return Promise.reject(fault);
        return (value as (...rest: unknown[]) => unknown).apply(target, args);
      };
    },
  });

const ADAPTER = {
  mongodbAdapter: () => (options: Parameters<ReturnType<typeof insertOrderedAdapter>>[0]) =>
    withFaults(insertOrderedAdapter(store as unknown as MemoryDB)(options)),
};

/** Which of `identifiers` the backend answers unreferenced, handed the batch alone or an address re-asked alone. */
let references: (identifiers: readonly string[]) => readonly string[] | Response = () => [];

// The references read alone: any other request, a drain's among them, fails the case.
const backend = serveBackend(({ method, path, body }) => {
  if (method !== "POST" || path !== "/identity/references") return undefined;
  const answer = references((body as FLReferencesPayload).identifiers);
  return answer instanceof Response ? answer : ({ unreferenced: [...answer] } satisfies FLReferencesResponse);
});
const { owed } = registerAuthDoubles({ specifiers: { "@better-auth/mongo-adapter": ADAPTER } });
const log = captureLog();

const { auth } = await import("@/core/auth/library.ts");
const { REFERENCES_ADDRESSES_MAX, runAccountSweep } = await import("./sweep.ts");

/** Opens an account at each address, as a sign-in leaves one. */
async function seed(addresses: readonly string[]): Promise<void> {
  const { adapter } = await auth.$context;
  for (const email of addresses) {
    await adapter.create({ model: "user", data: { email, emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() } });
  }
}

/** The addresses the store still holds an account at, in the order opened. */
const standing = (): string[] => store.user.map(({ email }) => email);

/** The addresses each references read asked about, in the order sent. */
const asked = (): string[][] => backend.sent.map(({ body }) => (body as FLReferencesPayload).identifiers);

/** `count` distinct addresses, as the store folds them. */
const adressen = (count: number, prefix = "person"): string[] => Array.from({ length: count }, (_, at) => `${prefix}${String(at)}@schule.de`);

/** Every address but those in `referenced` answered unreferenced, wherever it is asked. */
const unreferencedBut =
  (...referenced: string[]) =>
  (identifiers: readonly string[]): readonly string[] =>
    identifiers.filter((identifier) => !referenced.includes(identifier));

const failures = () => log.lines().filter(({ level }) => level === "ERROR");

beforeEach(() => {
  for (const rows of Object.values(store)) rows.length = 0;
  failing = undefined;
  references = () => [];
});

describe("which accounts a pass deletes", () => {
  it("deletes an account answered unreferenced in the batch and again alone, and never one the read does not answer", async () => {
    await seed(["erika@schule.de", "max@schule.de"]);
    references = unreferencedBut("max@schule.de");

    await runAccountSweep();

    expect(standing()).toStrictEqual(["max@schule.de"]);
  });

  /* The record can arrive between the batch's answer and the delete: asked again alone, just before
     it, the race narrows to the seconds between that answer and the delete. */
  it("keeps an account the batch answered unreferenced and the second ask no longer does", async () => {
    await seed(["erika@schule.de", "neu@schule.de"]);
    references = (identifiers) => (identifiers.length > 1 ? identifiers : unreferencedBut("neu@schule.de")(identifiers));

    await runAccountSweep();

    expect(standing()).toStrictEqual(["neu@schule.de"]);
    expect(asked().slice(1), "each unreferenced address is asked again, alone, before its delete").toStrictEqual([
      ["erika@schule.de"],
      ["neu@schule.de"],
    ]);
  });
});

describe("the batches a pass asks in", () => {
  /* The read refuses a batch past its ceiling whole, every pass alike, so a pass sending one would
     delete nothing ever after behind one failure line an hour. */
  it("asks one more account than the ceiling in two batches, none past it, each address once", async () => {
    const accounts = adressen(REFERENCES_ADDRESSES_MAX + 1);
    await seed(accounts);

    await runAccountSweep();

    expect(asked().map((batch) => batch.length)).toStrictEqual([REFERENCES_ADDRESSES_MAX, 1]);
    expect(asked().flat(), "an address was asked twice, or not at all").toStrictEqual(accounts);
  });
});

describe("a pass meeting a failure", () => {
  it("deletes nothing a failed batch asked about, still deletes from the next, and writes one failure line", async () => {
    const accounts = adressen(REFERENCES_ADDRESSES_MAX + 2);
    await seed(accounts);
    references = (identifiers) => (identifiers.length === REFERENCES_ADDRESSES_MAX ? networkFailure() : identifiers);

    // The batch it could not judge is what the pass left, which the heartbeat names.
    expect((await runAccountSweep()).open).toBe(REFERENCES_ADDRESSES_MAX);

    expect(standing()).toStrictEqual(accounts.slice(0, REFERENCES_ADDRESSES_MAX));
    expect(failures().map(({ message, fields }) => ({ message, fields }))).toStrictEqual([
      { message: "account.references_failed", fields: { name: "APINetworkError", count: REFERENCES_ADDRESSES_MAX } },
    ]);
  });

  it("keeps an account whose second ask fails, and goes on to the next", async () => {
    await seed(["a@schule.de", "b@schule.de", "c@schule.de"]);
    references = (identifiers) => (identifiers.length === 1 && identifiers[0] === "b@schule.de" ? networkFailure() : identifiers);

    await runAccountSweep();

    expect(standing()).toStrictEqual(["b@schule.de"]);
    expect(failures().map(({ message, fields }) => ({ message, fields }))).toStrictEqual([
      { message: "account.delete_failed", fields: { name: "APINetworkError" } },
    ]);
  });

  /* The store unreachable: the scheduler's heartbeat names the job only where it rejects, and a completion line would
     say a pass ran that listed nothing. */
  it("rejects a pass whose store cannot be listed, asking the backend nothing and writing no line", async () => {
    await seed(["a@schule.de"]);
    failing = (operation, { model }) => (operation === "findMany" && model === "user" ? new TypeError("no connection") : undefined);

    await expect(runAccountSweep()).rejects.toThrow("no connection");

    expect(backend.sent, "the pass asked the backend").toStrictEqual([]);
    expect(backend.served, "the pass owed a mail").toStrictEqual([]);
    expect(log.lines()).toStrictEqual([]);
  });
});

describe("what a completed pass answers", () => {
  /* Nothing is stored, so these counts on the scheduler's pass line are the whole record of what the sweep did, and
     the failed ones what the heartbeat names as left. */
  it("counts what was answered unreferenced, deleted, already gone and failed", async () => {
    await seed(["geloescht@schule.de", "fort@schule.de", "referenziert@schule.de", "neu@schule.de", "fehler@schule.de"]);
    references = (identifiers) => {
      // Deleted by another hand between the batch's answer and the re-ask before its own delete.
      if (identifiers.length === 1 && identifiers[0] === "fort@schule.de") store.user.splice(standing().indexOf("fort@schule.de"), 1);
      return identifiers.length > 1 ? unreferencedBut("referenziert@schule.de")(identifiers) : unreferencedBut("neu@schule.de")(identifiers);
    };
    failing = (operation, query) =>
      operation === "findOne" && addressOf(query) === "fehler@schule.de" ? new TypeError("no transaction for fehler@schule.de") : undefined;

    expect(await runAccountSweep()).toStrictEqual({
      count: { unreferenced: 4, deleted: 1, already_deleted: 1, failed: 1 },
      open: 1,
    });
    // The one account deleted is told it went; the one already gone, and the one that failed, are owed nothing.
    expect(owed.map(({ to, data }) => ({ to, data }))).toStrictEqual([
      { to: "geloescht@schule.de", data: { kind: "deletion_notice", saison_id: null } },
    ]);
  });
});
