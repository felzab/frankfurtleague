import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";
import { SERVER_COPY } from "@/core/serverCopy";
import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";

import type { FLAddressChangeAddressPayload, FLAddressChangeAddressResponse, FLRefusedField } from "@/core/generated/client/types";

const { field } = COPY.shared;

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
// administrator's passkeys behind on the old account, and nothing fails.
describe("a start, an account standing at the new address", () => {
  const TAKEN = { ok: false, errorCode: "address_change_taken", fieldErrors: { email: field.taken }, kinds: { email: "address_change_taken" } };

  // The harm: a refusal on the dialog's line rather than on the new address's box, which nothing then marks.
  it("is refused on the new address's box, and the start mints nothing", async () => {
    accountAt(NEW_ADDRESS);

    expect(await startLostMailboxChange(START)).toStrictEqual(TAKEN);
    expect(requestsSent()).toStrictEqual([]);
  });

  it("is refused by the backend's address_change_taken on the same box", async () => {
    const taken: FLRefusedField = { kind: "address_change_taken", path: ["email"], ctx: {}, in: "body" };
    backend.answerWith(({ method, path }) =>
      method === "POST" && path === "/address_change" ? refusal("address_change_taken", { fields: [taken] }) : undefined,
    );

    expect(await startLostMailboxChange(START)).toStrictEqual(TAKEN);
    expect(backend.sent.map(({ body }) => body)).toStrictEqual([{ address: START.address, email: NEW_ADDRESS }]);
  });
});

// The re-mint kills the earlier link, so a fresh one refused at its press costs the person the one that worked.
describe("a re-send, an account standing at the new address", () => {
  it("is refused in the start's sentence, and nothing is posted", async () => {
    accountAt(NEW_ADDRESS);

    expect(await resendChangeLink({ address_change_id: ID, holder: ADMIN_EMAIL })).toMatchObject({
      ok: false,
      reason: SERVER_COPY.refusalLine.address_change_taken,
    });
    // The new address's read alone: no re-mint.
    expect(requestsSent()).toStrictEqual(["POST /address_change/address"]);
  });
});

// The backend's answer when another person's records came to stand at the new address since the start.
describe("a re-send, the new address someone's", () => {
  it("is refused by the backend's address_change_taken in the start's sentence", async () => {
    backend.answerWith(({ method, path, body }) => {
      if (method === "POST" && path === "/address_change/address" && (body as FLAddressChangeAddressPayload).address_change_id === ID) {
        return { email: NEW_ADDRESS } satisfies FLAddressChangeAddressResponse;
      }
      return method === "POST" && path === `/address_change/${ID}/confirmation/resend` ? refusal("address_change_taken") : undefined;
    });

    expect(await resendChangeLink({ address_change_id: ID, holder: ADMIN_EMAIL })).toStrictEqual({
      ok: false,
      errorCode: "address_change_taken",
      reason: SERVER_COPY.refusalLine.address_change_taken,
    });
  });
});
