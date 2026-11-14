import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { describe, expect, it } from "vitest";

import { SERVER_COPY } from "@/core/serverCopy";

import type { FLAddressChangeAddressPayload, FLAddressChangeAddressResponse } from "@/core/generated/client/types";

const NEW_ADDRESS = "paul.neu@example.org";
const START = { address: "paul@example.org", email: NEW_ADDRESS, holder: ADMIN_EMAIL };
const ID = "64b000000000000000000002";

// The backend names the change's new address for its id, and answers nothing else: a start or a re-mint reaching it
// fails the case, which reads every request off `sent`.
const backend = serveBackend(({ method, path, body }) => {
  if (method === "POST" && path === "/address_change/address" && (body as FLAddressChangeAddressPayload).address_change_id === ID) {
    return { email: NEW_ADDRESS } satisfies FLAddressChangeAddressResponse;
  }
  return undefined;
});
// The administrator, signed in by passkey just now, which the touch these acts sit behind takes.
const { store } = signedInRequest();

const { resendChangeLink, startLostMailboxChange } = await import("./addressChangeActs");

/** An account signing in at `email`, as the sign-in store holds one. */
function accountAt(email: string): void {
  store.user.push({ id: "64c000000000000000000003", email, emailVerified: true, name: "", createdAt: new Date(), updatedAt: new Date() });
}

const requestsSent = () => backend.sent.map(({ method, path }) => `${method} ${path}`);

// The sign-in store is this server's and the backend cannot read it: a change confirmed onto such an address leaves the
// person's passkeys behind on the old account, and nothing fails.
describe("a start, an account standing at the new address", () => {
  // The harm: the start's dialog has closed before its answer, so a box's phrase would reach its toast as the pointer at
  // fields nobody sees.
  it("is refused in a sentence naming the new address, and nothing is posted", async () => {
    accountAt(NEW_ADDRESS);

    expect(await startLostMailboxChange(START)).toStrictEqual({
      ok: false,
      errorCode: "address_change_taken",
      reason: SERVER_COPY.refusalLine.address_change_taken,
    });
    expect(requestsSent()).toStrictEqual([]);
  });

  it.each(["address_change_taken", "address_change_occupied"] as const)("is refused by the backend's %s in the same sentence", async (code) => {
    // The backend names the new address's box, as its `find_taken_refusal` and `find_occupied_refusal` do.
    backend.answerWith(({ method, path }) =>
      method === "POST" && path === "/address_change"
        ? refusal(code, { fields: [{ path: ["email"], kind: code, ctx: {}, in: "body" }] })
        : undefined,
    );

    expect(await startLostMailboxChange(START)).toStrictEqual({
      ok: false,
      errorCode: code,
      reason: SERVER_COPY.refusalLine.address_change_taken,
    });
    expect(backend.sent.map(({ body }) => body)).toStrictEqual([{ address: START.address, email: NEW_ADDRESS }]);
  });
});

// The re-mint kills the earlier link, so a fresh one refused at its press costs the person the one that worked.
describe("a re-send, an account standing at the new address", () => {
  it("is refused in the re-send's own sentence, and nothing is posted", async () => {
    accountAt(NEW_ADDRESS);

    expect(await resendChangeLink({ address_change_id: ID, holder: ADMIN_EMAIL })).toMatchObject({
      ok: false,
      reason: SERVER_COPY.refusalLine.address_change_new_taken,
    });
    // The new address's read alone: no re-mint.
    expect(requestsSent()).toStrictEqual(["POST /address_change/address"]);
  });
});
