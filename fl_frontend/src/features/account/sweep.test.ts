import { assert, beforeEach, describe, expect, it } from "vitest";

import { answerTheLookup, faultingAdapter, GRANTED, insertOrderedAdapter, memoryStore, registerAuthDoubles } from "@/test-support/authDoubles";
import { networkFailure, refusal, serveBackend } from "@/test-support/backend";
import { captureLog } from "@/test-support/stdoutCapture";
import { NO_RECORDS } from "@/test-support/subjectFixtures";

import type { FLAddressChangeMovesResponse, FLReferencesPayload, FLReferencesResponse } from "@/core/generated/client/types";
import type { LookupFixture } from "@/test-support/subjectFixtures";
import type { MemoryDB } from "better-auth/adapters/memory";

/** The sign-in store under the real library: its own in-memory one, emptied before every case. */
const store = memoryStore("__flAccountSweepStore");

/** Set by a case to make the store fail the operations it names, as a store gone away or a failed transaction does. */
let failing:
  ((operation: string, query: { model?: string; where?: readonly { field: string; value: unknown }[] }) => Error | undefined) | undefined;

/** The address an operation reads a user row by, where it reads one so. */
const addressOf = (query: { where?: readonly { field: string; value: unknown }[] }): unknown =>
  query.where?.find(({ field }) => field === "email")?.value;

const ADAPTER = {
  mongodbAdapter: () => (options: Parameters<ReturnType<typeof insertOrderedAdapter>>[0]) =>
    faultingAdapter(insertOrderedAdapter(store as unknown as MemoryDB)(options), (operation, query) => failing?.(operation, query)),
};

/** Which of `identifiers` the backend answers unreferenced, handed the batch alone or an address re-asked alone. */
let references: (identifiers: readonly string[]) => readonly string[] | Response = () => [];

/** The carries the address changes still owe, as the backend lists them: none, unless a case names some. */
let carries: FLAddressChangeMovesResponse["moves"] | Response = [];

// The references read and the owed carries' list alone: any other request, a drain's among them, fails the case.
const backend = serveBackend(({ method, path, body }) => {
  if (method === "GET" && path === "/address_change/sweep/moves")
    return carries instanceof Response ? carries : ({ moves: carries } satisfies FLAddressChangeMovesResponse);
  if (method !== "POST" || path !== "/identity/references") return undefined;
  const answer = references((body as FLReferencesPayload).identifiers);
  return answer instanceof Response ? answer : ({ unreferenced: [...answer] } satisfies FLReferencesResponse);
});
const { owed } = registerAuthDoubles({ specifiers: { "@better-auth/mongo-adapter": ADAPTER } });
const log = captureLog();

/** Each passkey holder's grant as the sign-in read answers it, `null` for a read that fails: none, unless a case names one. */
let grants: (address: string) => LookupFixture | null = () => ({ ...NO_RECORDS, account: true });
answerTheLookup((address) => grants(address));

const { auth } = await import("@/core/auth/library");
const { REFERENCES_ADDRESSES_MAX, runAccountSweep } = await import("./sweep");

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
const addresses = (count: number, prefix = "person"): string[] =>
  Array.from({ length: count }, (_, at) => `${prefix}${String(at)}@schule.example.org`);

/** Every address but those in `referenced` answered unreferenced, wherever it is asked. */
const unreferencedBut =
  (...referenced: string[]) =>
  (identifiers: readonly string[]): readonly string[] =>
    identifiers.filter((identifier) => !referenced.includes(identifier));

/** Each ERROR line's event and its fields. */
const errorFields = () =>
  log
    .lines()
    .filter(({ level }) => level === "ERROR")
    .map(({ message, fields }) => ({ message, fields }));

/** Every ERROR line as the logger wrote it, its time, service and level set aside, its error where it has one. */
const failures = (): Record<string, unknown>[] =>
  log
    .lines()
    .filter(({ level }) => level === "ERROR")
    .map((line) => ({ trace_id: line.traceId, message: line.message, ...line.fields, ...("error" in line ? { error: line.error } : {}) }));

/** A transaction's read of the account at `address` refused, as a failed transaction's driver error names it. */
const readFailingAt =
  (address: string) =>
  (operation: string, query: { where?: readonly { field: string; value: unknown }[] }): Error | undefined =>
    operation === "findOne" && addressOf(query) === address ? new TypeError(`no transaction for ${address}`) : undefined;

beforeEach(() => {
  for (const rows of Object.values(store)) rows.length = 0;
  failing = undefined;
  references = () => [];
  carries = [];
  grants = () => ({ ...NO_RECORDS, account: true });
});

describe("which accounts a pass deletes", () => {
  it("deletes an account answered unreferenced in the batch and again alone, and never one the read does not answer", async () => {
    await seed(["erika@schule.example.org", "max@schule.example.org"]);
    references = unreferencedBut("max@schule.example.org");

    await runAccountSweep();

    expect(standing()).toStrictEqual(["max@schule.example.org"]);
  });

  /* The record can arrive between the batch's answer and the delete: asked again alone, just before
     it, the race narrows to the seconds between that answer and the delete. */
  it("keeps an account the batch answered unreferenced and the second ask no longer does", async () => {
    await seed(["erika@schule.example.org", "neu@schule.example.org"]);
    references = (identifiers) => (identifiers.length > 1 ? identifiers : unreferencedBut("neu@schule.example.org")(identifiers));

    await runAccountSweep();

    expect(standing()).toStrictEqual(["neu@schule.example.org"]);
    expect(asked().slice(1), "each unreferenced address is asked again, alone, before its delete").toStrictEqual([
      ["erika@schule.example.org"],
      ["neu@schule.example.org"],
    ]);
  });
});

describe("the batches a pass asks in", () => {
  /* The read refuses a batch past its ceiling whole, every pass alike, so a pass sending one would
     delete nothing ever after behind one failure line an hour. */
  it("asks one more account than the ceiling in two batches, none past it, each address once", async () => {
    const accounts = addresses(REFERENCES_ADDRESSES_MAX + 1);
    await seed(accounts);

    await runAccountSweep();

    expect(asked().map((batch) => batch.length)).toStrictEqual([REFERENCES_ADDRESSES_MAX, 1]);
    expect(asked().flat(), "an address was asked twice, or not at all").toStrictEqual(accounts);
  });
});

describe("a pass meeting a failure", () => {
  it("deletes nothing a failed batch asked about, still deletes from the next, and writes one failure line", async () => {
    const accounts = addresses(REFERENCES_ADDRESSES_MAX + 2);
    await seed(accounts);
    references = (identifiers) => (identifiers.length === REFERENCES_ADDRESSES_MAX ? networkFailure() : identifiers);

    // The batch it could not judge is what the pass left, which the heartbeat names.
    expect((await runAccountSweep()).open).toBe(REFERENCES_ADDRESSES_MAX);

    expect(standing()).toStrictEqual(accounts.slice(0, REFERENCES_ADDRESSES_MAX));
    expect(errorFields()).toStrictEqual([
      { message: "account.references_failed", fields: { name: "APINetworkError", count: REFERENCES_ADDRESSES_MAX } },
    ]);
  });

  it("keeps an account whose second ask fails, and goes on to the next", async () => {
    await seed(["a@schule.example.org", "b@schule.example.org", "c@schule.example.org"]);
    references = (identifiers) => (identifiers.length === 1 && identifiers[0] === "b@schule.example.org" ? networkFailure() : identifiers);

    await runAccountSweep();

    expect(standing()).toStrictEqual(["b@schule.example.org"]);
    expect(errorFields()).toStrictEqual([{ message: "account.delete_failed", fields: { name: "APINetworkError" } }]);
  });

  /* The store unreachable: the scheduler's heartbeat names the job only where it rejects, and a completion line would
     say a pass ran that listed nothing. */
  it("rejects a pass whose store cannot be listed, asking the backend nothing and writing no line", async () => {
    await seed(["a@schule.example.org"]);
    failing = (operation, { model }) => (operation === "findMany" && model === "user" ? new TypeError("no connection") : undefined);

    await expect(runAccountSweep()).rejects.toThrow("no connection");

    expect(backend.sent, "the pass asked the backend").toStrictEqual([]);
    expect(backend.served, "the pass owed a mail").toStrictEqual([]);
    expect(log.lines()).toStrictEqual([]);
  });

  /* A pass answering clean while the passkey listing fails every hour would leave every stray passkey signing in, named
     to nobody: the failure is the pass's `error`, which the heartbeat names. */
  it("answers a passkey listing that fails as the pass's error, the accounts' counts and what they left open beside it", async () => {
    await seed(["a@schule.example.org"]);
    references = () => networkFailure();
    const lost = new TypeError("no connection");
    failing = (operation, { model }) => (operation === "findMany" && model === "passkey" ? lost : undefined);

    expect(await runAccountSweep()).toStrictEqual({
      count: { unreferenced: 0, deleted: 0, already_deleted: 0, failed: 1, passkeys_deleted: 0, passkeys_failed: 0 },
      open: 1,
      error: lost,
    });
  });

  it("deletes the rest past one throwing delete, logging that one by the error's name alone", async () => {
    const accounts = ["a@schule.example.org", "b@schule.example.org", "c@schule.example.org"];
    await seed(accounts);
    references = (identifiers) => identifiers;
    failing = readFailingAt("b@schule.example.org");

    await runAccountSweep();

    // The account whose delete failed stands; the ones past it went.
    expect(standing()).toStrictEqual(["b@schule.example.org"]);
    // No `error` on the line at all: the failure's message and cause name the address.
    expect(failures()).toStrictEqual([{ trace_id: "SYSTEM", message: "account.delete_failed", name: "RolledBackError" }]);
  });

  /* The backend refuses the read whole where the grants it reads hold no live owner: an empty or wrong
     database would otherwise answer every address unreferenced, twice. */
  it("deletes nothing the backend's fail-safe refuses, and files the refusal on one failure line", async () => {
    await seed(["a@schule.example.org", "b@schule.example.org"]);
    references = () => refusal("no_owner");

    await runAccountSweep();

    expect(standing()).toStrictEqual(["a@schule.example.org", "b@schule.example.org"]);
    // The refusal's trace, which joins this line to the backend's own for that request.
    const trace = backend.sent[0]?.headers.get("traceparent")?.split("-")[1];
    assert.ok(trace !== undefined, "the read carried no trace, so the case compares nothing");
    expect(failures()).toStrictEqual([
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
    const accounts = [...addresses(REFERENCES_ADDRESSES_MAX + 1, "batch"), "geloescht@schule.example.org", "fehler@schule.example.org"];
    await seed(accounts);
    references = (identifiers) => (identifiers.length === REFERENCES_ADDRESSES_MAX ? networkFailure() : identifiers);
    failing = readFailingAt("fehler@schule.example.org");

    await runAccountSweep();

    const lines = log.lines();
    expect(lines.map(({ message }) => message)).toStrictEqual(["account.references_failed", "account.delete_failed"]);
    for (const { raw } of lines) {
      // The logger writes an address it is handed as its placeholder, so both spell a leak.
      assert.ok(!raw.includes("@") && !raw.includes("[address]"), `a line carries an address: ${raw}`);
    }
    expect(owed.map(({ to, data }) => ({ to, data }))).toStrictEqual(
      [`batch${String(REFERENCES_ADDRESSES_MAX)}@schule.example.org`, "geloescht@schule.example.org"].map((to) => ({
        to,
        data: { kind: "deletion_notice", saison_id: null },
      })),
    );
    // The references read alone, and no drain of the Postausgang: a drain's handout would be a request of its own.
    expect(new Set(backend.sent.map(({ method, path }) => `${method} ${path}`))).toStrictEqual(new Set(["POST /identity/references"]));
  });
});

/** A passkey for the account at `address`, signed in on two devices: one by that passkey, one by a mailed code. */
async function holdsPasskey(address: string): Promise<void> {
  const { adapter } = await auth.$context;
  const account = store.user.find(({ email }) => email === address);
  assert.ok(account !== undefined, `no account stands at ${address}`);
  await adapter.create({
    model: "passkey",
    data: { userId: account.id, credentialID: `credential-of-${address}`, publicKey: "k", counter: 0 },
  });
  const expiresAt = new Date(Date.now() + 3_600_000);
  for (const authFactor of ["passkey", "code"]) {
    await adapter.create({
      model: "session",
      data: { userId: account.id, token: `${authFactor}-${address}`, expiresAt, createdAt: new Date(), updatedAt: new Date(), authFactor },
    });
  }
}

/** Each passkey, and each session, by the address of the account holding it. */
const heldBy = () => {
  const addressOf = (userId: unknown) => store.user.find(({ id }) => id === userId)?.email;
  return {
    passkeys: store.passkey.map(({ userId }) => addressOf(userId)),
    sessions: store.session.map((row) => [addressOf(row.userId), Reflect.get(row, "authFactor")]),
  };
};

/* The harm: a passkey left at an address holding no grant -- a removal whose deletion failed, a grant removed by hand,
   a carry that failed between its two writes -- signs a person in as an administrator's factor, and no page lists it. */
describe("the passkeys a pass deletes", () => {
  it("deletes the passkeys of an address holding no grant and the sessions they made, its code session kept", async () => {
    await seed(["ehemalig@schule.example.org"]);
    await holdsPasskey("ehemalig@schule.example.org");

    expect((await runAccountSweep()).count.passkeys_deleted).toBe(1);

    expect(heldBy()).toStrictEqual({ passkeys: [], sessions: [["ehemalig@schule.example.org", "code"]] });
  });

  it("keeps the passkeys of an address holding a grant", async () => {
    await seed(["vorstand@schule.example.org"]);
    await holdsPasskey("vorstand@schule.example.org");
    grants = () => ({ ...GRANTED, account: true });

    expect((await runAccountSweep()).count.passkeys_deleted).toBe(0);

    expect(heldBy()).toStrictEqual({
      passkeys: ["vorstand@schule.example.org"],
      sessions: [
        ["vorstand@schule.example.org", "passkey"],
        ["vorstand@schule.example.org", "code"],
      ],
    });
  });

  /* An answer that never came says nothing of the grant, so the passkeys stay and the heartbeat names the address left. */
  it("deletes nothing of an address whose grant it cannot read, and leaves it open on one line naming no address", async () => {
    await seed(["ungelesen@schule.example.org", "ehemalig@schule.example.org"]);
    await holdsPasskey("ungelesen@schule.example.org");
    await holdsPasskey("ehemalig@schule.example.org");
    grants = (address) => (address === "ungelesen@schule.example.org" ? null : { ...NO_RECORDS, account: true });

    const { count, open } = await runAccountSweep();

    expect([count.passkeys_deleted, count.passkeys_failed, open]).toStrictEqual([1, 1, 1]);
    expect(heldBy().passkeys).toStrictEqual(["ungelesen@schule.example.org"]);
    expect(errorFields()).toStrictEqual([{ message: "account.passkeys_failed", fields: { name: "APINetworkError" } }]);
    for (const { raw } of log.lines()) assert.ok(!raw.includes("@") && !raw.includes("[address]"), `a line carries an address: ${raw}`);
  });

  /* The effect moves the grant to the new address before the frontend carries the account there: until the carry, an
     administrator's passkeys stand at the old address, which reads no grant, and are theirs. */
  it("keeps the passkeys of an address whose account an address change still owes to carry, and deletes the rest", async () => {
    await seed(["alt@schule.example.org", "ehemalig@schule.example.org"]);
    await holdsPasskey("alt@schule.example.org");
    await holdsPasskey("ehemalig@schule.example.org");
    carries = [{ id: "6890a1b2c3d4e5f607260001", old: "alt@schule.example.org", new: "neu@schule.example.org" }];
    grants = (address) => (address === "neu@schule.example.org" ? { ...GRANTED, account: true } : { ...NO_RECORDS, account: true });

    const { count, open } = await runAccountSweep();

    expect([count.passkeys_deleted, count.passkeys_failed, open]).toStrictEqual([1, 0, 0]);
    expect(heldBy().passkeys).toStrictEqual(["alt@schule.example.org"]);
  });

  /* An owed carry's list that never came says nothing of whose passkeys stand at an address the carry has yet to leave. */
  it("deletes no passkey where the owed carries cannot be listed, and leaves each open on one line naming no address", async () => {
    await seed(["ehemalig@schule.example.org"]);
    await holdsPasskey("ehemalig@schule.example.org");
    carries = networkFailure();

    const { count, open } = await runAccountSweep();

    expect([count.passkeys_deleted, count.passkeys_failed, open]).toStrictEqual([0, 1, 1]);
    expect(heldBy().passkeys).toStrictEqual(["ehemalig@schule.example.org"]);
    expect(errorFields()).toStrictEqual([{ message: "account.passkeys_failed", fields: { name: "APINetworkError", count: 1 } }]);
  });
});

describe("what a completed pass answers", () => {
  /* Nothing is stored, so these counts on the scheduler's pass line are the whole record of what the sweep did, and
     the failed ones what the heartbeat names as left. */
  it("counts what was answered unreferenced, deleted, already gone and failed", async () => {
    await seed([
      "geloescht@schule.example.org",
      "fort@schule.example.org",
      "referenziert@schule.example.org",
      "neu@schule.example.org",
      "fehler@schule.example.org",
    ]);
    references = (identifiers) => {
      // Deleted by another hand between the batch's answer and the re-ask before its own delete.
      if (identifiers.length === 1 && identifiers[0] === "fort@schule.example.org")
        store.user.splice(standing().indexOf("fort@schule.example.org"), 1);
      return identifiers.length > 1
        ? unreferencedBut("referenziert@schule.example.org")(identifiers)
        : unreferencedBut("neu@schule.example.org")(identifiers);
    };
    failing = readFailingAt("fehler@schule.example.org");

    expect(await runAccountSweep()).toStrictEqual({
      count: { unreferenced: 4, deleted: 1, already_deleted: 1, failed: 1, passkeys_deleted: 0, passkeys_failed: 0 },
      open: 1,
    });
    // The one account deleted is told it went; the one already gone, and the one that failed, are owed nothing.
    expect(owed.map(({ to, data }) => ({ to, data }))).toStrictEqual([
      { to: "geloescht@schule.example.org", data: { kind: "deletion_notice", saison_id: null } },
    ]);
  });
});
