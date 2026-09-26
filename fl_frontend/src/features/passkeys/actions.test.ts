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

/** Allowlisted by nothing: the person lane of every guard below. */
const PERSON_EMAIL = "spielerin@example.org";

/** A second person, whose rows no call made with the first one's session may reach. */
const OTHER_EMAIL = "schiedsrichter@example.org";

/** The person's one account page, which every passkey notice links. */
const KONTO = "/bereich/konto";

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

type SessionRow = {
  id: string;
  token: string;
  userId: string;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
  authFactor?: string;
  passkeyCredentialId?: string;
};

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
const { auth, getAdminSession } = await import("@/core/auth");
const { removePasskeyAction, renamePasskeyAction } = await import("./actions.ts");
const { KONTO_FORBIDDEN } = await import("@/shared/utils/kontoMutation");
const { PASSKEY_NAME_MAX } = await import("./schemas.ts");

const HOUR_MS = 60 * 60 * 1000;

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

/** A session the named passkey made `ageMs` ago: the stamp its assertion writes, set on the stored row. */
async function signedInWith(email: string, credentialID: string, ageMs = 0): Promise<{ cookie: string; row: SessionRow }> {
  const session = await signIn(email);
  session.row.authFactor = "passkey";
  session.row.passkeyCredentialId = credentialID;
  session.row.createdAt = new Date(Date.now() - ageMs);
  session.row.updatedAt = new Date();

  return session;
}

/** Answers every guard below as one request would: the cookie they read off `headers()`. */
function arriveAs(cookie: string): void {
  globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie });
}

/** A stored passkey as the plugin's own routes read one, so an admitted call would really act. */
function seedPasskey(userId: string, label: string): Record<string, unknown> & { id: string; credentialID: string } {
  const row = {
    id: `ein-passkey-${label}`,
    userId: userId,
    credentialID: `fabricated-credential-${label}`,
    publicKey: "fabricated-public-key",
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    transports: "internal",
    aaguid: "00000000-0000-0000-0000-000000000000",
    createdAt: new Date(),
  };
  store.passkey.push(row);

  return row;
}

const sessionIds = (): string[] => store.session.map((row) => row.id).sort();

describe("the session a passkey action opens on", () => {
  /* The administrator's lane is the passkey's: a session the mailbox alone made may not manage the
     authenticator that guards the administration. */
  it("refuses an administrator's session the passkey did not make, leaving every row standing", async () => {
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    const held = seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);

    assert.deepEqual(await removePasskeyAction(held.id), { success: false, error: KONTO_FORBIDDEN });
    assert.deepEqual(await renamePasskeyAction(held.id, "Mein Schlüssel"), { success: false, error: KONTO_FORBIDDEN });
    assert.equal(store.passkey.length, 2);
    assert.equal(Reflect.get(held, "name"), undefined);
  });

  /* A person's lane admits either factor: a person signed in by code manages their own passkeys too. */
  it("admits a person's session whichever factor made it", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    const held = seedPasskey(row.userId, "eins");
    arriveAs(cookie);

    assert.equal((await renamePasskeyAction(held.id, "Mein Schlüssel")).success, true);
  });
});

describe("the confirmation every change waits for", () => {
  /* Two hours, measured from the sign-in or the last confirmation, which is a sign-in itself: past it
     a cookie alone could otherwise swap the holder's authenticator for its own. */
  it("refuses a removal and a rename from a session signed in three hours ago, and asks for a confirmation", async () => {
    const { cookie, row } = await signedInWith(PERSON_EMAIL, "fabricated-credential-eins", 3 * HOUR_MS);
    const held = seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);

    const removal = await removePasskeyAction(held.id);
    const rename = await renamePasskeyAction(held.id, "Mein Schlüssel");

    assert.equal(removal.success, false);
    assert.equal(Reflect.get(removal, "bestaetigen"), true, "the page is not told to ask for a confirmation");
    assert.equal(Reflect.get(rename, "bestaetigen"), true, "the page is not told to ask for a confirmation");
    assert.equal(store.passkey.length, 2, "a session past the window removed a row");
    assert.equal(Reflect.get(held, "name"), undefined, "a session past the window renamed a row");
  });

  /* The window is hours, not the minutes an earlier rule gave: an hour-old sign-in still counts. */
  it("admits a removal from a session signed in an hour ago", async () => {
    const { cookie, row } = await signedInWith(PERSON_EMAIL, "fabricated-credential-zwei", HOUR_MS);
    const held = seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);

    assert.equal((await removePasskeyAction(held.id)).success, true);
  });
});

describe("what a removal costs, and what it refuses", () => {
  /* The last ROW an administrator holds is their way into the administration. */
  it("refuses an administrator's only passkey", async () => {
    const admin = await signIn(ADMIN_EMAIL);
    const held = seedPasskey(admin.row.userId, "eins");
    const { cookie } = await signedInWith(ADMIN_EMAIL, held.credentialID);
    arriveAs(cookie);

    const answer = await removePasskeyAction(held.id);

    assert.equal(answer.success, false);
    assert.equal(store.passkey.length, 1, "the administrator's only passkey was removed");
  });

  /* A person holding none signs in by code again, so their last one is theirs to remove. */
  it("removes a person's only passkey", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    const held = seedPasskey(row.userId, "eins");
    arriveAs(cookie);

    assert.equal((await removePasskeyAction(held.id)).success, true);
    assert.deepEqual(store.passkey, []);
  });

  it("deletes the row asked for, mails that it happened with a link to the account page, and refreshes the page", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    const held = seedPasskey(row.userId, "eins");
    seedPasskey(row.userId, "zwei");
    arriveAs(cookie);

    const answer = await removePasskeyAction(held.id);

    assert.deepEqual(answer, { success: true, message: "Passkey gelöscht", diesesGeraet: false });
    assert.deepEqual(
      store.passkey.map((entry) => entry.id),
      ["ein-passkey-zwei"],
    );
    assert.deepEqual(cacheCalls, [{ name: "refresh", args: [] }], "the page was left standing");
    assert.equal(sent.at(-1)?.to, PERSON_EMAIL);
    assert.ok(sent.at(-1)?.text.includes(KONTO), "the notice does not link the account page");
    // The event and the time, and nothing off the row: its identifiers stay in the store.
    const written = JSON.stringify(sent.at(-1));
    for (const secret of [held.id, held.credentialID, row.token]) {
      assert.ok(!written.includes(secret), "the notice carries material from the row it reports");
    }
  });

  /* The removal ends the devices THAT passkey signed in and no other: a device a second passkey or a
     code signed in keeps its session (`docs/frontend/spec.md :: I313`). */
  it("ends the sessions the removed passkey made, and none another passkey or a code made", async () => {
    const { row: first } = await signIn(PERSON_EMAIL);
    const removed = seedPasskey(first.userId, "eins");
    const kept = seedPasskey(first.userId, "zwei");

    const byRemoved = await signedInWith(PERSON_EMAIL, removed.credentialID);
    const byKept = await signedInWith(PERSON_EMAIL, kept.credentialID);
    const byCode = await signIn(PERSON_EMAIL);
    const acting = await signIn(PERSON_EMAIL);
    arriveAs(acting.cookie);

    const answer = await removePasskeyAction(removed.id);

    assert.equal(answer.success, true);
    assert.ok(!store.session.some((row) => row.id === byRemoved.row.id), "a device the removed passkey signed in kept its session");
    for (const survivor of [byKept.row, byCode.row, acting.row, first]) {
      assert.ok(
        store.session.some((row) => row.id === survivor.id),
        "a device the removed passkey never signed in was signed out",
      );
    }
  });

  /* The page's own session is among those the passkey made where the holder confirmed with it: the
     action says so, and the page sends the holder to the sign-in page. */
  it("ends this device's session too where the removed passkey made it, and says so", async () => {
    const { row: first } = await signIn(PERSON_EMAIL);
    const held = seedPasskey(first.userId, "eins");
    seedPasskey(first.userId, "zwei");
    const acting = await signedInWith(PERSON_EMAIL, held.credentialID);
    arriveAs(acting.cookie);

    const answer = await removePasskeyAction(held.id);

    assert.deepEqual(answer, { success: true, message: "Passkey gelöscht", diesesGeraet: true });
    assert.ok(!store.session.some((row) => row.id === acting.row.id), "the session the removed passkey made survived");
  });

  /* The rows are read off the caller's own account, so another person's identifier is absent rather than taken. */
  it("refuses another person's passkey, leaving it and their sessions standing", async () => {
    const other = await signIn(OTHER_EMAIL);
    const theirs = seedPasskey(other.row.userId, "fremd");
    const theirSession = await signedInWith(OTHER_EMAIL, theirs.credentialID);
    const { cookie, row } = await signIn(PERSON_EMAIL);
    seedPasskey(row.userId, "eins");
    arriveAs(cookie);

    const answer = await removePasskeyAction(theirs.id);

    assert.equal(answer.success, false);
    assert.ok(
      store.passkey.some((entry) => entry.id === theirs.id),
      "another person's passkey was removed",
    );
    assert.ok(
      store.session.some((entry) => entry.id === theirSession.row.id),
      "another person's session was ended",
    );
  });

  /* Without a real transaction the claim conflicts with nothing, and two removals at once would leave
     no row (`docs/frontend/spec.md :: I312`). */
  it("refuses a removal that reaches no real transaction, deleting nothing", async () => {
    const admin = await signIn(ADMIN_EMAIL);
    const held = seedPasskey(admin.row.userId, "eins");
    seedPasskey(admin.row.userId, "zwei");
    const { cookie } = await signedInWith(ADMIN_EMAIL, held.credentialID);
    arriveAs(cookie);
    globals[PASS_THROUGH] = true;
    const mails = sent.length;

    const answer = await removePasskeyAction(held.id);

    assert.deepEqual(
      { success: answer.success, rows: store.passkey.length, notices: sent.length - mails },
      { success: false, rows: 2, notices: 0 },
    );
  });

  it("refuses an identifier that is not a row's at all, and signs nobody out", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    seedPasskey(row.userId, "eins");
    const other = await signIn(PERSON_EMAIL);
    arriveAs(cookie);
    const before = sessionIds();

    assert.equal((await removePasskeyAction("")).success, false);
    assert.equal((await removePasskeyAction("kein-solcher-eintrag")).success, false);
    assert.equal(store.passkey.length, 1);
    assert.deepEqual(sessionIds(), before, "a refused removal signed a device out");
    assert.ok(store.session.some((entry) => entry.id === other.row.id));
  });

  /* An administrator's removal still ends the admin surface for the devices that passkey signed in. */
  it("ends the administration for a device the removed passkey signed in", async () => {
    const admin = await signIn(ADMIN_EMAIL);
    const removed = seedPasskey(admin.row.userId, "eins");
    const kept = seedPasskey(admin.row.userId, "zwei");
    const elsewhere = await signedInWith(ADMIN_EMAIL, removed.credentialID);
    const here = await signedInWith(ADMIN_EMAIL, kept.credentialID);

    arriveAs(elsewhere.cookie);
    assert.ok(await getAdminSession(), "the other device does not open the admin surface to begin with");

    arriveAs(here.cookie);
    assert.equal((await removePasskeyAction(removed.id)).success, true);

    arriveAs(elsewhere.cookie);
    assert.equal(await getAdminSession(), null, "the device the removed passkey signed in kept the administration");
    arriveAs(here.cookie);
    assert.ok(await getAdminSession(), "the removal ended a device another passkey signed in");
  });
});

describe("what a rename writes", () => {
  it("stores the trimmed name on the holder's own row", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    const held = seedPasskey(row.userId, "eins");
    arriveAs(cookie);

    assert.deepEqual(await renamePasskeyAction(held.id, "  Mein iPhone  "), { success: true, message: "Passkey umbenannt" });
    assert.equal(Reflect.get(held, "name"), "Mein iPhone");
    assert.deepEqual(cacheCalls, [{ name: "refresh", args: [] }], "the page was left standing");
  });

  /* The bound nothing else sets: the plugin takes any length, and the card and the list draw the name. */
  it("refuses a name past the limit and an empty one, leaving the row as it stood", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    const held = seedPasskey(row.userId, "eins");
    arriveAs(cookie);

    assert.equal((await renamePasskeyAction(held.id, "x".repeat(PASSKEY_NAME_MAX + 1))).success, false);
    assert.equal((await renamePasskeyAction(held.id, "   ")).success, false);
    assert.equal((await renamePasskeyAction(held.id, "x".repeat(PASSKEY_NAME_MAX))).success, true);
  });

  it("refuses another person's row, leaving its name as it stood", async () => {
    const other = await signIn(OTHER_EMAIL);
    const theirs = seedPasskey(other.row.userId, "fremd");
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    assert.equal((await renamePasskeyAction(theirs.id, "Übernommen")).success, false);
    assert.equal(Reflect.get(theirs, "name"), undefined);
  });
});
