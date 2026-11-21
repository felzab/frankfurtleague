import { beforeEach, describe, expect, it } from "vitest";

import { answerTheLookup, faultingAdapter, GRANTED, insertOrderedAdapter, memoryStore, registerAuthDoubles } from "@/test-support/authDoubles";
import { serveBackend } from "@/test-support/backend";
import { NO_RECORDS } from "@/test-support/subjectFixtures";

import type { FLAddressChangeMovesResponse } from "@/core/generated/client/types";
import type { MemoryDB } from "better-auth/adapters/memory";

/** The owed carries the backend lists, page after page; a case sets them. */
let pages: FLAddressChangeMovesResponse["moves"][] = [];

// The backend lists the owed carries a page at a time and takes the report of each page carried; nothing else.
const backend = serveBackend(({ method, path }) => {
  if (method === "GET" && path === "/address_change/sweep/moves") return { moves: pages.shift() ?? [] } satisfies FLAddressChangeMovesResponse;
  if (method === "POST" && path === "/address_change/sweep/moves/done") return new Response(null, { status: 204 });
  return undefined;
});

/** The sign-in library's in-memory store, the accounts the pass carries among it. */
const store = memoryStore("__flMovesStore");

/** Set by a case to make the store fail the operations it names, as a store gone away does. */
let failing: ((operation: string, query: { model?: string }) => Error | undefined) | undefined;

registerAuthDoubles({
  specifiers: {
    "@better-auth/mongo-adapter": {
      mongodbAdapter: () => (options: Parameters<ReturnType<typeof insertOrderedAdapter>>[0]) =>
        faultingAdapter(insertOrderedAdapter(store as unknown as MemoryDB)(options), (operation, query) => failing?.(operation, query)),
    },
  },
});
// Every carry reads the new address's grant first: none, unless a case names one.
answerTheLookup(() => ({ ...NO_RECORDS, account: true }));

beforeEach(() => {
  for (const rows of Object.values(store)) rows.length = 0;
  failing = undefined;
});

const { runAddressChangeMoves } = await import("./moves");

const move = (n: number) => ({
  id: n.toString(16).padStart(24, "0"),
  old: `alt${String(n)}@schule.example.org`,
  new: `neu${String(n)}@schule.example.org`,
});

/** The account of each move's replaced address, signed in on one device. */
function accountsOf(moves: readonly ReturnType<typeof move>[]): void {
  const now = new Date();
  for (const { id, old } of moves) {
    const userId = `64c${id.slice(3)}`;
    store.user.push({ id: userId, email: old, emailVerified: true, name: "", createdAt: now, updatedAt: now });
    store.session.push({
      id: `64d${id.slice(3)}`,
      token: `token-of-${old}`,
      userId,
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
    });
  }
}

/* Owed on the ended record and listed until reported: a carry never reported is listed, and carried, every pass. */
describe("the owed carries", () => {
  it("carries every listed account, reports each page carried, and ends once the list is empty", async () => {
    const moves = [move(1), move(2), move(3)];
    accountsOf(moves);
    pages = [[move(1), move(2)], [move(3)]];

    await runAddressChangeMoves();

    // Each account now signs in at its new address alone, its sessions at the replaced one ended.
    expect(store.user.map(({ email }) => email)).toStrictEqual([
      "neu1@schule.example.org",
      "neu2@schule.example.org",
      "neu3@schule.example.org",
    ]);
    expect(store.session).toStrictEqual([]);
    expect(backend.sent.map(({ method, path, body }) => [`${method} ${path}`, body])).toStrictEqual([
      ["GET /address_change/sweep/moves", undefined],
      ["POST /address_change/sweep/moves/done", { ids: [move(1).id, move(2).id] }],
      ["GET /address_change/sweep/moves", undefined],
      ["POST /address_change/sweep/moves/done", { ids: [move(3).id] }],
      ["GET /address_change/sweep/moves", undefined],
    ]);
  });

  /* The harm: a grant removed while a failed carry waited deleted no passkey, the account standing at the old address
     then, and the carry brings a removed administrator's passkeys across, where they still sign in. */
  it("brings no passkey across to an address holding no grant, and keeps an administrator's", async () => {
    const moves = [move(1), move(2)];
    accountsOf(moves);
    for (const { id } of moves) store.passkey.push({ id: `64e${id.slice(3)}`, userId: `64c${id.slice(3)}`, credentialID: `credential-${id}` });
    // The first move's new address holds the grant the change moved; the second's none, its grant removed meanwhile.
    answerTheLookup((email) => (email === move(1).new ? { ...GRANTED, account: true } : { ...NO_RECORDS, account: true }));
    pages = [moves];

    await runAddressChangeMoves();

    expect(store.passkey.map(({ userId }) => store.user.find(({ id }) => id === userId)?.email)).toStrictEqual([move(1).new]);
  });

  /* The harm: a first run whose deletion failed carried the account already, so its retry finds none to carry, and a
     deletion keyed on that carry would leave the passkeys signing in at an address holding no grant for good. */
  it("deletes on the retry the passkeys a first run carried and failed to delete, and the sessions they made since", async () => {
    accountsOf([move(1)]);
    const userId = `64c${move(1).id.slice(3)}`;
    store.passkey.push({ id: `64e${move(1).id.slice(3)}`, userId, credentialID: "credential-carried" });
    let failures = 1;
    failing = (operation, { model }) => {
      if (operation !== "deleteMany" || model !== "passkey" || failures === 0) return undefined;
      failures -= 1;
      return new TypeError("connection closed");
    };
    pages = [[move(1)], [move(1)]];

    await expect(runAddressChangeMoves()).rejects.toThrow("connection closed");
    expect(
      store.user.map(({ email }) => email),
      "the first run carried nothing, so the retry proves nothing",
    ).toStrictEqual([move(1).new]);
    // The passkey the first run left signs in at the new address before the retry.
    const now = new Date();
    store.session.push({
      id: "64d000000000000000000099",
      token: "token-of-the-kept-passkey",
      userId,
      expiresAt: new Date(now.getTime() + 3_600_000),
      createdAt: now,
      updatedAt: now,
      authFactor: "passkey",
      passkeyCredentialId: "credential-carried",
    });

    await runAddressChangeMoves();

    expect(store.passkey).toStrictEqual([]);
    expect(store.session).toStrictEqual([]);
    expect(backend.sent.filter(({ method }) => method === "POST").map(({ body }) => body)).toStrictEqual([{ ids: [move(1).id] }]);
  });
});
