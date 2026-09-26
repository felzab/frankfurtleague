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
  signInByCode,
} from "@/core/authDoubles.ts";
import { cacheCalls, NEXT_CACHE_DOUBLE } from "@/shared/testing/actionDoubles.ts";

const STORE = "__flKontoStore";
const REQUEST_HEADERS = "__flKontoRequestHeaders";

/** Allowlisted by nothing: the person lane. */
const PERSON_EMAIL = "spielerin@example.org";

/** A second person, whose sign-ins no call made with the first one's session may reach. */
const OTHER_EMAIL = "schiedsrichter@example.org";

const HEADERS_DOUBLE = `export const headers = async () => globalThis.${REQUEST_HEADERS};`;

const LOGGING_DOUBLE = `export const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };`;

const ADAPTER_DOUBLE = `import { memoryAdapter } from ${JSON.stringify(MEMORY_ADAPTER_URL)};
export const mongodbAdapter = () => memoryAdapter(globalThis.${STORE});`;

// Every address this file signs in is seated: the gate at session creation is not its subject.
seatEveryAddress();

registerAuthDoubles({
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

const globals = globalThis as unknown as Record<string, unknown>;
globals[STORE] = store;

// Imported here rather than at the top: a static import resolves before the hooks above are registered.
const { endAndereAnmeldungenAction, endAnmeldungAction } = await import("./actions.ts");
const { readSicherheit } = await import("./sicherheit.ts");
const { auth, getKontoSession } = await import("@/core/auth");
const { PERSON_LIFETIME } = await import("@/core/sessionLifetimes");

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

beforeEach(() => {
  store.passkey.length = 0;
  store.session.length = 0;
  cacheCalls.length = 0;
});

/** Mints a session the way a typed code does, and hands back its cookie and its stored row. */
async function signIn(email: string): Promise<{ cookie: string; row: SessionRow }> {
  const cookie = cookieHeader(await signInByCode(auth, email));

  const row = store.session.at(-1);
  assert.ok(row !== undefined, "the verification wrote no session row");

  return { cookie, row };
}

function arriveAs(cookie: string): void {
  globals[REQUEST_HEADERS] = new Headers({ ...ORIGIN, cookie });
}

/** The section's read as the page makes it, for the session the request carries. */
async function sicherheitAs(cookie: string) {
  arriveAs(cookie);
  const served = await getKontoSession();
  assert.ok(served !== null, "the account's guard refused a session the page is shown to");
  return readSicherheit(served);
}

describe("what the sign-in list hands the page", () => {
  /* The row's `token` is the session cookie's own value: a page holding it could hand any device's
     session to a script (`docs/frontend/spec.md :: I420`). */
  it("carries no session's token, this device's or another's", async () => {
    const other = await signIn(PERSON_EMAIL);
    const { cookie, row } = await signIn(PERSON_EMAIL);

    const answer = await sicherheitAs(cookie);
    const written = JSON.stringify(answer);

    assert.equal(answer.anmeldungen.length, 2);
    for (const token of [row.token, other.row.token]) assert.ok(!written.includes(token), "a session token reached the page");
    assert.deepEqual(Object.keys(answer.anmeldungen[0] ?? {}).sort(), [
      "angemeldetAm",
      "diesesGeraet",
      "endetSpaetestensAm",
      "faktor",
      "id",
      "zuletztAktivAm",
    ]);
  });

  it("marks this device, lists it first, and lists no other person's sign-in", async () => {
    await signIn(OTHER_EMAIL);
    const elsewhere = await signIn(PERSON_EMAIL);
    const { cookie, row } = await signIn(PERSON_EMAIL);

    const { anmeldungen } = await sicherheitAs(cookie);

    assert.deepEqual(
      anmeldungen.map((anmeldung) => [anmeldung.id, anmeldung.diesesGeraet]),
      [
        [row.id, true],
        [elsewhere.row.id, false],
      ],
    );
  });

  /* The adapter answers 100 rows where no limit is named, and the device a holder is looking for would
     be the one past them. */
  it("lists every live sign-in, past the adapter's default page of 100", async () => {
    const elsewhere = await signIn(PERSON_EMAIL);
    for (let seeded = 1; seeded <= 100; seeded += 1) {
      store.session.push({ ...elsewhere.row, id: `weitere-${String(seeded)}`, token: `token-${String(seeded)}` });
    }
    const { cookie } = await signIn(PERSON_EMAIL);

    const { anmeldungen } = await sicherheitAs(cookie);

    assert.equal(anmeldungen.length, 102);
  });

  /* Judged as the guards judge the served session: a row the next request would refuse is no device
     still signed in, however long the store keeps it. */
  it("leaves out a sign-in past its idle window, one past the library's expiry, and one no factor this league mints made", async () => {
    const idle = await signIn(PERSON_EMAIL);
    idle.row.updatedAt = new Date(Date.now() - 400 * DAY_MS);
    const expired = await signIn(PERSON_EMAIL);
    expired.row.expiresAt = new Date(Date.now() - 1000);
    const byOldLink = await signIn(PERSON_EMAIL);
    byOldLink.row.authFactor = "link";
    const { cookie, row } = await signIn(PERSON_EMAIL);

    const { anmeldungen } = await sicherheitAs(cookie);

    assert.deepEqual(
      anmeldungen.map((anmeldung) => anmeldung.id),
      [row.id],
    );
  });

  /* The person area and this page admit an administrator's session for the person lifetime; listed by
     the administration's 48 hours, a device still reaching every person page would be missing here. */
  it("lists an administrator's sign-in the person area still admits, ending it at the person cap", async () => {
    const older = await signIn(ADMIN_EMAIL);
    older.row.createdAt = new Date(Date.now() - 3 * DAY_MS);
    older.row.updatedAt = new Date(Date.now() - DAY_MS);
    const { cookie, row } = await signIn(ADMIN_EMAIL);
    row.authFactor = "passkey";

    const { anmeldungen } = await sicherheitAs(cookie);

    assert.deepEqual(
      anmeldungen.map((anmeldung) => anmeldung.id),
      [row.id, older.row.id],
    );
    assert.equal(anmeldungen[1]?.endetSpaetestensAm, new Date(older.row.createdAt.getTime() + PERSON_LIFETIME.absolute).toISOString());
  });

  it("names the passkey a sign-in was made with, and the code for one the mail made", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    store.passkey.push({
      id: "ein-passkey",
      userId: row.userId,
      credentialID: "fabricated-credential",
      publicKey: "fabricated-public-key",
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      aaguid: "00000000-0000-0000-0000-000000000000",
      name: "Mein iPhone",
      createdAt: new Date(),
    });
    const byPasskey = await signIn(PERSON_EMAIL);
    byPasskey.row.authFactor = "passkey";
    byPasskey.row.passkeyCredentialId = "fabricated-credential";

    const { anmeldungen } = await sicherheitAs(cookie);

    assert.deepEqual(anmeldungen.find((anmeldung) => anmeldung.id === byPasskey.row.id)?.faktor, { art: "passkey", name: "Mein iPhone" });
    assert.deepEqual(anmeldungen.find((anmeldung) => anmeldung.id === row.id)?.faktor, { art: "code" });
  });

  /* The latest the sign-in can end, whatever the holder does: the lane's absolute cap from the sign-in,
     which activity never moves, where the idle window slides. */
  it("ends a person's sign-in at the latest the person lane's cap after it began", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    row.updatedAt = new Date();

    const { anmeldungen } = await sicherheitAs(cookie);

    assert.equal(anmeldungen[0]?.endetSpaetestensAm, new Date(new Date(row.createdAt).getTime() + PERSON_LIFETIME.absolute).toISOString());
  });

  it("hands the card its names and dates, and never the key or the credential", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    const zuletzt = new Date("2026-09-20T08:00:00.000Z");
    store.passkey.push({
      id: "ein-passkey",
      userId: row.userId,
      credentialID: "fabricated-credential",
      publicKey: "fabricated-public-key",
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
      aaguid: "00000000-0000-0000-0000-000000000000",
      createdAt: new Date("2026-09-01T08:00:00.000Z"),
      lastUsedAt: zuletzt,
    });

    const { passkeys } = await sicherheitAs(cookie);
    const written = JSON.stringify(passkeys);

    assert.deepEqual(passkeys, [
      {
        id: "ein-passkey",
        name: null,
        anbieter: null,
        eingerichtetAm: "2026-09-01T08:00:00.000Z",
        zuletztVerwendetAm: zuletzt.toISOString(),
        diesesGeraet: false,
      },
    ]);
    assert.ok(
      !written.includes("fabricated-public-key") && !written.includes("fabricated-credential"),
      "a key or a credential reached the page",
    );
  });
});

describe("ending one sign-in", () => {
  it("ends the holder's other sign-in it names, and no other", async () => {
    const ended = await signIn(PERSON_EMAIL);
    const kept = await signIn(PERSON_EMAIL);
    const { cookie, row } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    assert.deepEqual(await endAnmeldungAction(ended.row.id), { success: true, message: "Abgemeldet" });
    assert.deepEqual(store.session.map((entry) => entry.id).sort(), [kept.row.id, row.id].sort());
    assert.deepEqual(cacheCalls, [{ name: "refresh", args: [] }], "the page was left standing");
  });

  /* A row is ended only where its id AND the holder's own user id match: an id copied off another
     person's page ends nothing (`docs/frontend/spec.md :: I421`). */
  it("ends nothing for another person's sign-in id, and says the list is stale", async () => {
    const theirs = await signIn(OTHER_EMAIL);
    const { cookie } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    const answer = await endAnmeldungAction(theirs.row.id);

    assert.equal(answer.success, false);
    assert.ok(
      store.session.some((entry) => entry.id === theirs.row.id),
      "another person's session was ended",
    );
  });

  it("refuses this device's own sign-in, which the bar ends with its cookie", async () => {
    const { cookie, row } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    assert.equal((await endAnmeldungAction(row.id)).success, false);
    assert.ok(store.session.some((entry) => entry.id === row.id));
  });

  it("refuses from a session signed in three hours ago, and asks for a confirmation", async () => {
    const other = await signIn(PERSON_EMAIL);
    const { cookie, row } = await signIn(PERSON_EMAIL);
    row.createdAt = new Date(Date.now() - 3 * HOUR_MS);
    arriveAs(cookie);

    const answer = await endAnmeldungAction(other.row.id);

    assert.equal(Reflect.get(answer, "stepUp"), true);
    assert.ok(
      store.session.some((entry) => entry.id === other.row.id),
      "a session past the window ended a sign-in",
    );
  });
});

describe("ending every other sign-in", () => {
  it("ends every sign-in of the holder's but this device's, and no other person's", async () => {
    await signIn(PERSON_EMAIL);
    await signIn(PERSON_EMAIL);
    const theirs = await signIn(OTHER_EMAIL);
    const { cookie, row } = await signIn(PERSON_EMAIL);
    arriveAs(cookie);

    assert.deepEqual(await endAndereAnmeldungenAction(), { success: true, message: "Alle anderen abgemeldet" });
    assert.deepEqual(store.session.map((entry) => entry.id).sort(), [theirs.row.id, row.id].sort());
  });

  it("refuses from a session signed in three hours ago, and asks for a confirmation", async () => {
    const other = await signIn(PERSON_EMAIL);
    const { cookie, row } = await signIn(PERSON_EMAIL);
    row.createdAt = new Date(Date.now() - 3 * HOUR_MS);
    arriveAs(cookie);

    assert.equal(Reflect.get(await endAndereAnmeldungenAction(), "stepUp"), true);
    assert.ok(store.session.some((entry) => entry.id === other.row.id));
  });

  /* An administrator's lane is the passkey's: a session the mailbox alone made may end nothing. */
  it("refuses an administrator's session the passkey did not make", async () => {
    const other = await signIn(ADMIN_EMAIL);
    const { cookie } = await signIn(ADMIN_EMAIL);
    arriveAs(cookie);

    assert.equal((await endAndereAnmeldungenAction()).success, false);
    assert.equal((await endAnmeldungAction(other.row.id)).success, false);
    assert.ok(store.session.some((entry) => entry.id === other.row.id));
  });
});
