import { ADMIN_EMAIL } from "@/test-support/authDoubles";
import { refusal, serveBackend } from "@/test-support/backend";
import { signedInRequest } from "@/test-support/session";
import { assert, beforeEach, describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import type { FLErasureViewResponse } from "@/core/generated/client/types";

/** The address the administrator erases. */
const ERASED = "max@example.org";

const NO_RECORDS: FLErasureViewResponse = {
  spieler: 0,
  schiedsrichter: 0,
  kontakt_seats: 0,
  bewerbung_seats: 0,
  registrierungen: 0,
  spiele: 0,
  address_change: 0,
  grants: 0,
};

/** What the backend holds for the case, and whether the erased address's account stood when the records went. */
const held = { view: NO_RECORDS, refused: false, accountAtTheErasure: undefined as boolean | undefined };

// The question's read and the erasure itself, each answered only for the address the case erases.
const backend = serveBackend(({ method, path, body }) => {
  if (method !== "POST" || (body as { email?: string }).email !== ERASED) return undefined;
  if (path === "/identity/erasure/view") return held.view;
  if (path !== "/identity/erasure") return undefined;
  held.accountAtTheErasure = accounts().includes(ERASED);
  return held.refused ? refusal("own_address") : new Response(null, { status: 204 });
});
// The administrator, signed in by passkey just now, which the erasure's touch admits; the erased address's account
// stands in the same memory store.
const { arriveAs, store } = signedInRequest();

const { eraseAddress, readErasureCounts } = await import("./erasureActs");

/** Every address the sign-in store holds an account at. */
const accounts = () => store.user.map(({ email }) => email);

/**
 * An account at the erased address holding `passkeys` passkeys, made by that person's own sign-in, the administrator
 * then arriving again by passkey.
 */
async function accountAtTheErasedAddress(passkeys = 0): Promise<void> {
  await arriveAs({ email: ERASED });
  await arriveAs({ email: ADMIN_EMAIL, admin: true });
  const account = store.user.find(({ email }) => email === ERASED);
  assert(account !== undefined, "the sign-in made no account at the erased address");
  for (let n = 0; n < passkeys; n += 1) {
    store.passkey.push({
      id: `a-passkey-${String(n)}`,
      userId: account.id,
      credentialID: `a-credential-${String(n)}`,
      publicKey: "fabricated",
    });
  }
}

// The page's holder is the administrator the page was drawn for, as the touch's act requires.
const press = () => eraseAddress({ email: ERASED, reason: "Mail vom 3.11.2026", holder: ADMIN_EMAIL });

const asked = async () => {
  const answer = await readErasureCounts({ email: ERASED, reason: "Mail vom 3.11.2026" });
  assert(answer.ok);
  return answer.value.question;
};

beforeEach(() => {
  held.view = NO_RECORDS;
  held.refused = false;
  held.accountAtTheErasure = undefined;
});

describe("the erasure's question", () => {
  // The harm: „Unter dieser Adresse steht nichts.“ over an account the act then deletes.
  it("counts an address holding its account alone, each row above zero and no other", async () => {
    await accountAtTheErasedAddress(2);

    expect(await asked()).toMatchObject({
      consequence: COPY.admin.erasure.consequence,
      facts: [
        { label: COPY.template.account, value: { record: "1" } },
        { label: COPY.account.passkeys.title, value: { record: "2" } },
      ],
    });
  });

  it("says an address holds nothing only where the league and the sign-in store both do", async () => {
    expect(await asked()).toMatchObject({ consequence: COPY.admin.nothingAtAddress, facts: [] });
  });
});

describe("the erasure's two stores", () => {
  it("deletes the account after the records, and says so", async () => {
    await accountAtTheErasedAddress();

    expect(await press()).toStrictEqual({ ok: true, value: undefined, note: COPY.admin.erased });
    expect(backend.sent.map(({ method, path }) => `${method} ${path}`)).toStrictEqual(["POST /identity/erasure"]);
    // The account stood while the records went, and is gone once the press answers.
    expect(held.accountAtTheErasure).toBe(true);
    expect(accounts()).not.toContain(ERASED);
  });

  it("leaves the account standing where the backend refuses the records", async () => {
    await accountAtTheErasedAddress();
    held.refused = true;

    expect(await press()).toMatchObject({ ok: false, reason: SERVER_COPY.refusalLine.own_address });
    expect(accounts()).toContain(ERASED);
  });
});
