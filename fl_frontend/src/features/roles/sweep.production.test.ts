import { insertOrderedAdapter, memoryStore, registerAuthDoubles } from "@/test-support/authDoubles.ts";
import { networkFailure, refusal, serveBackend } from "@/test-support/backend.ts";
import { captureLog } from "@/test-support/stdoutCapture.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import type { FLReferencesPayload, FLReferencesResponse } from "@/core/generated/client/types.ts";
import type { MemoryDB } from "better-auth/adapters/memory";

/* Run under a production build's `NODE_ENV`, whose JSON line carries `trace_id` and every `error` handed the logger:
   the plain line every other project writes leaves out the trace and any `error` that is no `Error`, so a case proving
   which trace a line carries, or that a value never reached a line, reads the JSON. */

/** The sign-in store under the real library: its own in-memory one, emptied before every case. */
const store = memoryStore("__flAccountSweepProductionStore");

/** The address each transaction's read of a user row fails for, as a failed transaction's driver error names it. */
let failingAt: string | undefined;

/**
 * The library's in-memory adapter, each transaction it opens failing its read of the account at `failingAt`: the
 * store's own failure, at the database's edge.
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
        const { where } = (args[0] ?? {}) as { where?: { field: string; value: unknown }[] };
        const address = where?.find(({ field }) => field === "email")?.value;
        if (key === "findOne" && address !== undefined && address === failingAt) {
          return Promise.reject(new TypeError(`no transaction for ${String(address)}`));
        }
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

/** Every ERROR line, as the production build wrote it. */
const failures = (): Record<string, unknown>[] =>
  log
    .lines()
    .filter(({ level }) => level === "ERROR")
    .map(({ raw }) => JSON.parse(raw) as Record<string, unknown>);

/** A line's own fields, its envelope set aside. */
const fieldsOf = ({ timestamp: _at, service: _service, level: _level, ...rest }: Record<string, unknown>) => rest;

/** `count` distinct addresses, as the store folds them. */
const adressen = (count: number, prefix = "person"): string[] => Array.from({ length: count }, (_, at) => `${prefix}${String(at)}@schule.de`);

beforeEach(() => {
  for (const rows of Object.values(store)) rows.length = 0;
  failingAt = undefined;
  references = () => [];
});

it("runs under a production build's NODE_ENV", () => {
  expect(process.env.NODE_ENV, "a project writing the plain line shows neither the trace nor a non-Error `error`").toBe("production");
});

describe("a pass meeting a failure", () => {
  it("deletes the rest past one throwing delete, logging that one by the error's name alone", async () => {
    const accounts = ["a@schule.de", "b@schule.de", "c@schule.de"];
    await seed(accounts);
    references = (identifiers) => identifiers;
    failingAt = "b@schule.de";

    await runAccountSweep();

    // The account whose delete failed stands; the ones past it went.
    expect(standing()).toStrictEqual(["b@schule.de"]);
    // No `error` on the line at all: the failure's message and cause name the address.
    expect(failures().map(fieldsOf)).toStrictEqual([{ trace_id: "SYSTEM", message: "account.delete_failed", name: "RolledBackError" }]);
  });

  /* The backend refuses the read whole where the grants it reads hold no live owner: an empty or wrong
     database would otherwise answer every address unreferenced, twice. */
  it("deletes nothing the backend's fail-safe refuses, and files the refusal on one failure line", async () => {
    await seed(["a@schule.de", "b@schule.de"]);
    references = () => refusal("no_owner");

    await runAccountSweep();

    expect(standing()).toStrictEqual(["a@schule.de", "b@schule.de"]);
    // The refusal's trace, which joins this line to the backend's own for that request.
    const trace = backend.sent[0]?.headers.get("traceparent")?.split("-")[1];
    assert.ok(trace !== undefined, "the read carried no trace, so the case compares nothing");
    expect(failures().map(fieldsOf)).toStrictEqual([
      {
        trace_id: trace,
        message: "account.references_failed",
        name: "APIBadStatusError",
        status: 409,
        server_error_code: "no_owner",
        count: 2,
      },
    ]);
  });

  /* Every kind of line a pass writes, each failure carrying an address in its error the way a real one does: an
     account's address is what this pass must never put on a line. The pass owes the deletion notice of each account it
     deleted, as every deletion of an account does, and nothing else; the Postausgang's drain is the scheduler's, after
     every job. */
  it("names no address on any line, and owes no mail but each deleted account's notice", async () => {
    const accounts = [...adressen(REFERENCES_ADDRESSES_MAX + 1, "batch"), "geloescht@schule.de", "fehler@schule.de"];
    await seed(accounts);
    references = (identifiers) => (identifiers.length === REFERENCES_ADDRESSES_MAX ? networkFailure() : identifiers);
    failingAt = "fehler@schule.de";

    await runAccountSweep();

    const lines = log.lines();
    expect(lines.map(({ message }) => message)).toStrictEqual(["account.references_failed", "account.delete_failed"]);
    for (const { raw } of lines) {
      // The logger writes an address it is handed as its placeholder, so both spell a leak.
      assert.ok(!raw.includes("@") && !raw.includes("[address]"), `a line carries an address: ${raw}`);
    }
    expect(owed.map(({ to, data }) => ({ to, data }))).toStrictEqual(
      [`batch${String(REFERENCES_ADDRESSES_MAX)}@schule.de`, "geloescht@schule.de"].map((to) => ({
        to,
        data: { kind: "deletion_notice", saison_id: null },
      })),
    );
    // The references read alone, and no drain of the Postausgang: a drain's handout would be a request of its own.
    expect(new Set(backend.sent.map(({ method, path }) => `${method} ${path}`))).toStrictEqual(new Set(["POST /identity/references"]));
  });
});
