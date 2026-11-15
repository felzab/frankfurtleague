import { memoryAdapterDouble, memoryStore, registerAuthDoubles } from "@/test-support/authDoubles.ts";
import { serveBackend } from "@/test-support/backend.ts";
import { describe, expect, it } from "vitest";

import type {
  FLAddressChangeMovesDonePayload,
  FLAddressChangeMovesDoneResponse,
  FLAddressChangeMovesResponse,
} from "@/core/generated/client/types.ts";

/** The owed carries the backend lists, page after page; a case sets them. */
let pages: FLAddressChangeMovesResponse["moves"][] = [];

// The backend lists the owed carries a page at a time and takes the report of each page carried; nothing else.
const backend = serveBackend(({ method, path, body }) => {
  if (method === "GET" && path === "/address_change/sweep/moves") return { moves: pages.shift() ?? [] } satisfies FLAddressChangeMovesResponse;
  if (method === "POST" && path === "/address_change/sweep/moves/done") {
    return { done: (body as FLAddressChangeMovesDonePayload).ids.length } satisfies FLAddressChangeMovesDoneResponse;
  }
  return undefined;
});

/** Where the sign-in library's in-memory store is held, the accounts the pass carries among it. */
const STORE = "__flMovesStore";
registerAuthDoubles({ specifiers: { "@better-auth/mongo-adapter": memoryAdapterDouble(STORE) } });
const store = memoryStore(STORE);

const { runAddressChangeMoves } = await import("./moves.ts");

const move = (n: number) => ({ id: n.toString(16).padStart(24, "0"), old: `alt${String(n)}@schule.de`, new: `neu${String(n)}@schule.de` });

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
    expect(store.user.map(({ email }) => email)).toStrictEqual(["neu1@schule.de", "neu2@schule.de", "neu3@schule.de"]);
    expect(store.session).toStrictEqual([]);
    expect(backend.sent.map(({ method, path, body }) => [`${method} ${path}`, body])).toStrictEqual([
      ["GET /address_change/sweep/moves", undefined],
      ["POST /address_change/sweep/moves/done", { ids: [move(1).id, move(2).id] }],
      ["GET /address_change/sweep/moves", undefined],
      ["POST /address_change/sweep/moves/done", { ids: [move(3).id] }],
      ["GET /address_change/sweep/moves", undefined],
    ]);
  });
});
