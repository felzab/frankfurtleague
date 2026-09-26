import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  ADMIN_EMAIL,
  asDataUrl,
  configDouble,
  cookieHeader,
  GATE_BACKEND_CONFIG,
  MEMORY_ADAPTER_URL,
  ORIGIN,
  registerAuthDoubles,
  seatEveryAddress,
  seedLink,
} from "@/core/authDoubles.ts";
import { cacheCalls, NEXT_CACHE_DOUBLE } from "@/shared/testing/actionDoubles.ts";

const STORE = "__flPasskeyStore";
const REQUEST_HEADERS = "__flPasskeyRequestHeaders";
const PASS_THROUGH = "__flPasskeyPassThrough";

/** Allowlisted by nothing, so every guard below has an arm that is refused for the address alone. */
const PERSON_EMAIL = "spielerin@example.org";

const HEADERS_DOUBLE = `export const headers = async () => globalThis.${REQUEST_HEADERS};`;

const LOGGING_DOUBLE = `export const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };`;

/* Where the flag is set, `transaction` hands the adapter itself back, which is what the Mongo adapter
   does when it is given no client: the shape the removal must refuse rather than trust. */
const ADAPTER_DOUBLE = `import { memoryAdapter } from ${JSON.stringify(MEMORY_ADAPTER_URL)};
export const mongodbAdapter = () => (options) => {
  const adapter = memoryAdapter(globalThis.${STORE})(options);
  const served = { ...adapter, transaction: (callback) => (globalThis.${PASS_THROUGH} ? callback(served) : adapter.transaction(callback)) };
  return served;
};`;

// Every address this file signs in is seated: the gate at session creation is not its subject.
seatEveryAddress();

const mail = registerAuthDoubles({
  core: { logging: LOGGING_DOUBLE, config: configDouble(GATE_BACKEND_CONFIG) },
  specifiers: {
    "next/headers": asDataUrl(HEADERS_DOUBLE),
    "next/cache": asDataUrl(NEXT_CACHE_DOUBLE),
    "@better-auth/mongo-adapter": asDataUrl(ADAPTER_DOUBLE),
  },
});

type SessionRow = { token: string; userId: string; expiresAt: Date; createdAt: Date; updatedAt: Date; authFactor?: string };

type Store = {
  user: { id: string; email: string }[];
  session: SessionRow[];
  account: unknown[];
  verification: { id: string; identifier: string; value: string; expiresAt: Date; createdAt: Date; updatedAt: Date }[];
  passkey: Record<string, unknown>[];
};

const store: Store = { user: [], session: [], account: [], verification: [], passkey: [] };
const sent = mail.sent;

const globals = globalThis as unknown as Record<string, unknown>;
globals[STORE] = store;

// Imported here rather than at the top: a static import resolves before the hooks above are
// registered, so none of the doubles would be in place yet.
const { auth, getAdminSession, PASSKEY_LIMIT } = await import("@/core/auth");
const { readPasskeysAction, removePasskeyAction } = await import("./actions.ts");
const { ADMIN_FORBIDDEN } = await import("@/shared/utils/adminMutation");

const { STEP_UP_WINDOW_MS } = await import("@/core/sessionLifetimes.ts");

beforeEach(() => {
  globals[PASS_THROUGH] = false;
  store.passkey.length = 0;
  store.session.length = 0;
  cacheCalls.length = 0;
});

/** Mints a session the way a followed link does, and hands back its cookie and its stored row. */
async function signIn(email: string): Promise<{ cookie: string; row: SessionRow }> {
  const verified = await auth.api.magicLinkVerify({
    query: { token: seedLink(store.verification, email) },
    headers: new Headers(ORIGIN),
    returnHeaders: true,
  });
  const cookie = cookieHeader(verified);

  const row = store.session.at(-1);
  assert.ok(row !== undefined, "the verification wrote no session row");

  return { cookie, row };
}

/** The administrator the dialog acts as: the passkey made the session, and made it just now. */
async function steppedUpAdmin(): Promise<{ cookie: string; row: SessionRow }> {
  const session = await signIn(ADMIN_EMAIL);
  session.row.authFactor = "passkey";
  session.row.createdAt = new Date();
  session.row.updatedAt = new Date();

  return session;
}

/** Answers every guard below as one request would: the cookie they read off `headers()`. */
function arriveAs(cookie: string): void {
  globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie });
}

/** A stored passkey as the plugin's own routes read one, so an admitted call would really act. */
function seedPasskey(userId: string, label: string): Record<string, unknown> {
  const row = {
    id: `ein-passkey-${label}`,
    userId: userId,
    credentialID: `fabricated-credential-${label}`,
    publicKey: "fabricated-public-key",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    transports: "internal",
    // A name the enrolling caller chose, which the projection drops and the refusal above keeps
    // out in the first place.
    name: "Windows Hello",
    // The AAGUID every privacy-preserving platform reports, which `getAuthenticatorName` answers
    // `undefined` for: the row that proves `label` is its own field rather than a fallback.
    aaguid: "00000000-0000-0000-0000-000000000000",
    createdAt: new Date(),
  };
  store.passkey.push(row);

  return row;
}

describe("the session each passkey action opens on", () => {
  /* The proxy turns an unauthenticated `/bereich/admin` POST away, and this is what holds whatever reaches
     the action anyway — a session the mailed link alone made included. */
  it("refuses the list to a session the passkey did not make, and reads no rows for it", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    seedPasskey(row.userId, "eins");
    arriveAs(cookie);

    const answer = await readPasskeysAction();

    assert.deepEqual(answer, { success: false, error: ADMIN_FORBIDDEN });
  });

  it("refuses the removal to that same session, leaving every row standing", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const held = seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);

    const answer = await removePasskeyAction(String(held.id));

    assert.deepEqual(answer, { success: false, error: ADMIN_FORBIDDEN });
    assert.equal(store.passkey.length, 2);
  });

  /* The allowlist arm of the same guard: `getAdminSession` judges the address as well as the factor,
     and a person's session reaching this action would list and remove somebody's credentials. */
  it("refuses both to an address the allowlist does not carry", async () => {
    const person = await signIn(PERSON_EMAIL);
    person.row.authFactor = "passkey";
    const held = seedPasskey(person.row.userId, "eins");
    seedPasskey(person.row.userId, "zwei");
    arriveAs(person.cookie);

    assert.deepEqual(await readPasskeysAction(), { success: false, error: ADMIN_FORBIDDEN });
    assert.deepEqual(await removePasskeyAction(String(held.id)), { success: false, error: ADMIN_FORBIDDEN });
    assert.equal(store.passkey.length, 2);
  });
});

describe("what the list hands the dialog", () => {
  /* `listPasskeys` answers the WHOLE row, the public key and the credential id among its fields.
     Neither is drawn anywhere, and I198's argument is that what a script cannot read it cannot leak. */
  it("projects each row to what the dialog draws and nothing else", async () => {
    const { cookie, row } = await steppedUpAdmin();
    seedPasskey(row.userId, "eins");
    arriveAs(cookie);

    const answer = await readPasskeysAction();

    assert.ok(answer.success);
    assert.deepEqual(Object.keys(answer.passkeys[0] ?? {}).sort(), ["createdAt", "id", "label"]);
    // The AAGUID every platform authenticator reports resolves to no make at all, so the field is
    // null rather than silently taking the caller's own `name`.
    assert.equal(answer.passkeys[0]?.label, null);
    assert.ok(!JSON.stringify(answer).includes("Windows Hello"), "the name its own enroller chose reached the page");
    assert.ok(!JSON.stringify(answer).includes("fabricated-public-key"), "the public key reached the page");
    assert.ok(!JSON.stringify(answer).includes("fabricated-credential-eins"), "the credential id reached the page");
  });

  /* The cap's own half of the answer, which is what closes the add control: judged again at the
     enrolment itself, so this decides what the reader meets rather than what the server allows. */
  it("closes the add control at the cap and leaves it open below one", async () => {
    const { cookie, row } = await steppedUpAdmin();
    for (let index = 0; index < PASSKEY_LIMIT - 1; index += 1) seedPasskey(row.userId, String(index));
    arriveAs(cookie);

    const below = await readPasskeysAction();
    assert.ok(below.success);
    assert.equal(below.kannHinzufuegen, true);

    seedPasskey(row.userId, "letzter");
    const atTheCap = await readPasskeysAction();

    assert.ok(atTheCap.success);
    assert.equal(atTheCap.kannHinzufuegen, false);
  });
});

describe("what a removal costs, and what it refuses", () => {
  /* The last ROW is what this protects; what protects this administrator's own authenticator is the
     step-up. At zero rows the mailed link enrols again, so the refusal is about the page rather
     than about lockout. */
  it("refuses the only row an administrator holds", async () => {
    const { cookie, row } = await steppedUpAdmin();
    const held = seedPasskey(row.userId, "eins");
    arriveAs(cookie);

    const answer = await removePasskeyAction(String(held.id));

    assert.equal(answer.success, false);
    assert.equal(store.passkey.length, 1, "the only passkey was removed");
  });

  /* The step-up, which is the whole of what a stolen cookie cannot do: the dialog re-runs the
     assertion ceremony before it calls this, and a session past the step-up window has not. */
  it("refuses a removal from a session whose assertion is past the step-up window", async () => {
    const { cookie, row } = await steppedUpAdmin();
    row.createdAt = new Date(Date.now() - STEP_UP_WINDOW_MS - 60_000);
    const held = seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);

    const answer = await removePasskeyAction(String(held.id));

    assert.equal(answer.success, false);
    assert.equal(store.passkey.length, 2, "a session that did not assert removed a row");
  });

  it("deletes the row a stepped-up administrator asks for, and mails that it happened", async () => {
    const { cookie, row } = await steppedUpAdmin();
    const held = seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);

    const answer = await removePasskeyAction(String(held.id));

    assert.equal(answer.success, true);
    assert.deepEqual(
      store.passkey.map((entry) => entry.id),
      ["ein-passkey-zwei"],
    );
    assert.deepEqual(cacheCalls, [{ name: "refresh", args: [] }], "the administrator's page was left standing");
    assert.equal(sent.at(-1)?.to, ADMIN_EMAIL);
    // The event and the time, and nothing off the row: a name the caller chose would otherwise
    // reach the mailbox as though this league had written it.
    const written = JSON.stringify(sent.at(-1));
    for (const secret of [String(held.id), String(held.credentialID), row.token]) {
      assert.ok(!written.includes(secret), "the notice carries material from the row it reports");
    }
  });

  /* The sign-in store is written past the API client, and a notice withheld before it leaves records no
     write either: the removal's own record is all that refreshes the page. */
  it("refreshes the page after a removal whose notice never left", async () => {
    const { cookie, row } = await steppedUpAdmin();
    const held = seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);
    mail.answerWith(() => "withheld");

    assert.equal((await removePasskeyAction(String(held.id))).success, true);
    assert.deepEqual(
      sent.map(({ to }) => to),
      [ADMIN_EMAIL],
      "the notice never reached the mailer to be withheld",
    );
    assert.deepEqual(cacheCalls, [{ name: "refresh", args: [] }], "the administrator's page was left standing");
  });

  /* A removal ends the administrator's other sessions at the same moment: a device signed in with
     the removed authenticator would otherwise keep the window it already has. */
  it("ends this administrator's other sessions, so their cookie stops opening the admin surface", async () => {
    const first = await steppedUpAdmin();
    const second = await steppedUpAdmin();
    assert.equal(first.row.userId, second.row.userId, "the two sessions belong to different people");

    const held = seedPasskey(first.row.userId, "eins");
    seedPasskey(first.row.userId, "zwei");

    arriveAs(second.cookie);
    assert.ok(await getAdminSession(), "the second session does not open the admin surface to begin with");

    arriveAs(first.cookie);
    assert.equal((await removePasskeyAction(String(held.id))).success, true);

    arriveAs(second.cookie);
    assert.equal(await getAdminSession(), null, "the other device kept the window the removal was supposed to close");

    arriveAs(first.cookie);
    assert.ok(await getAdminSession(), "the removal ended the session that made it");
  });

  /* Without a real transaction the claim conflicts with nothing, and two removals at once would leave
     no row (`docs/frontend/spec.md :: I312`). */
  it("refuses a removal that reaches no real transaction, deleting nothing", async () => {
    const { cookie, row } = await steppedUpAdmin();
    const held = seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);
    globals[PASS_THROUGH] = true;

    const answer = await removePasskeyAction(String(held.id));

    assert.deepEqual({ success: answer.success, rows: store.passkey.length, notices: sent.length }, { success: false, rows: 2, notices: 0 });
  });

  /* A server action's argument is whatever a caller posted, and this one reaches a store query. */
  it("refuses an identifier that is not a row's at all", async () => {
    const { cookie, row } = await steppedUpAdmin();
    seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);

    assert.equal((await removePasskeyAction("")).success, false);
    assert.equal((await removePasskeyAction("kein-solcher-eintrag")).success, false);
    assert.equal(store.passkey.length, 2);
  });

  /* The removal is judged before anyone is signed out: signed out first, every other device would
     lose its window over a passkey that still stands. That the sign-out rolls back with a refused
     transaction is `fl_frontend/src/features/passkeys/actions.db.test.ts`'s to show. */
  it("leaves the other sessions standing where the removal is refused", async () => {
    const first = await steppedUpAdmin();
    const second = await steppedUpAdmin();
    seedPasskey(first.row.userId, "eins");
    seedPasskey(first.row.userId, "zwei");

    arriveAs(first.cookie);
    const answer = await removePasskeyAction("kein-solcher-eintrag");

    assert.equal(answer.success, false);
    assert.equal(store.passkey.length, 2, "a failed deletion took a row with it");

    arriveAs(second.cookie);
    assert.ok(await getAdminSession(), "a refused removal signed the other device out");
  });
});
