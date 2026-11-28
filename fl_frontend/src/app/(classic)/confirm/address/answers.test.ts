import { beforeEach, describe, expect, it, vi } from "vitest";

import { ROUTES } from "@/core/routes";
import { serveBackend } from "@/test-support/backend";
import { forgottenLinks } from "@/test-support/nextRequest";
import { signedInRequest } from "@/test-support/session";
import { thrownRedirect } from "@/test-support/thrownRedirect";

import { LINK_INVALID } from "./ends";

import type { FLAddressChangeAnswerResponse, FLAddressChangeMovesResponse } from "@/core/generated/client/types";

/** The new mailbox's link, the one token the backend's lookup names the new address for. */
const TOKEN = "tok_abc";
const PREVIOUS = "alt@schule.example.org";
const NEW = "neu@schule.example.org";
const EFFECTIVE: FLAddressChangeAnswerResponse = { answer: "confirmed", effective: true, effective_from: null };
const MOVE: FLAddressChangeMovesResponse["moves"][number] = { id: "6890a1b2c3d4e5f607260001", old: PREVIOUS, new: NEW };

/** What the backend holds for the case: the carries it owes, and a read of them it holds until the case releases it. */
const held = { owed: [] as FLAddressChangeMovesResponse["moves"], movesRead: Promise.resolve() };

// The backend the press reads and writes: the new address of the token's change, the press itself, and the owed
// carries the effect leaves, each answered only as the action spells it.
const backend = serveBackend(async ({ method, path, body }) => {
  const { token, answer } = (body ?? {}) as { token?: string; answer?: string };
  if (method === "POST" && path === "/address_change/address" && token === TOKEN) return { email: NEW };
  if (method === "POST" && path === "/address_change/confirmation" && token === TOKEN && answer === "confirmed") return EFFECTIVE;
  if (method === "POST" && path === "/address_change/confirmation/stop" && token === TOKEN) return new Response(null, { status: 204 });
  if (method === "GET" && path === "/address_change/sweep/moves") {
    await held.movesRead;
    return { moves: held.owed } satisfies FLAddressChangeMovesResponse;
  }
  if (method === "POST" && path === "/address_change/sweep/moves/done") {
    const { ids } = body as { ids: string[] };
    held.owed = held.owed.filter(({ id }) => !ids.includes(id));
    return new Response(null, { status: 204 });
  }
  return undefined;
});
// Nobody signed in: the link's token is the press's whole credential. An account stands in the store by its own
// sign-in, which `arriveAs` makes.
const { arriveAs, store } = signedInRequest(null);

const { answerAddressChange, stopAddressChange } = await import("./answers");

const requests = () => backend.sent.map(({ method, path }) => `${method} ${path}`);

beforeEach(() => {
  held.owed = [];
  held.movesRead = Promise.resolve();
});

// The view's refusal guards the page as it opened; an account opened between the view and the press is this press's
// alone to refuse, and without it the change takes effect onto an address whose own account the carry then leaves
// standing.
describe("the new mailbox's press, an account standing at the new address", () => {
  it("is refused as the link no longer valid, and nothing is posted", async () => {
    await arriveAs({ email: NEW });
    await arriveAs(null);

    expect(await answerAddressChange({ token: TOKEN, side: "new", way: "account", act: "primary" })).toStrictEqual({
      ok: true,
      value: LINK_INVALID,
    });
    expect(requests()).toStrictEqual(["POST /address_change/address"]);
  });
});

// The done end invites the sign-in at the new address, which opens an empty account there while the carry is owed.
describe("the effect's account carry", () => {
  it("is made before the press answers", async () => {
    await arriveAs({ email: PREVIOUS });
    await arriveAs(null);
    held.owed = [MOVE];
    let release: () => void = () => undefined;
    held.movesRead = new Promise((resolve) => (release = resolve));

    let settled = false;
    // Next's redirect, thrown past the action, names the done page the press leads to.
    const answer = thrownRedirect(answerAddressChange({ token: TOKEN, side: "new", way: "account", act: "primary" })).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(requests()).toContain("GET /address_change/sweep/moves"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(settled).toBe(false);

    release();
    expect((await answer).address).toBe(`${ROUTES.addressChangeDone.path()}?end=new`);
    // Forgotten once done, on the page's own path, the path it was set on.
    expect(forgottenLinks()).toStrictEqual([{ value: undefined, path: ROUTES.addressChangeConfirmation.path() }]);
    // Carried by the time the press answered: the account signs in at the new address, the carry reported done.
    expect(store.user.map(({ email }) => email)).toStrictEqual([NEW]);
    expect(backend.sent.find(({ path }) => path === "/address_change/sweep/moves/done")?.body).toStrictEqual({ ids: [MOVE.id] });
  });
});

// The privacy notice keeps a mailed link's cookie until the link is used, and the stop uses it as an answer does.
describe("the address on file's stop", () => {
  it("forgets the link on the page's own path before it leads to the stopped end", async () => {
    expect((await thrownRedirect(stopAddressChange({ token: TOKEN }))).address).toBe(`${ROUTES.addressChangeDone.path()}?end=stopped`);
    expect(forgottenLinks()).toStrictEqual([{ value: undefined, path: ROUTES.addressChangeConfirmation.path() }]);
  });
});
