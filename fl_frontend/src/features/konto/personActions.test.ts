import { cacheCalls, NEXT_CACHE_DOUBLE } from "@/test-support/actionDoubles.ts";
import {
  configDouble,
  GATE_BACKEND_CONFIG,
  insertOrderedAdapter,
  madeByPasskey,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  sessionByCode,
} from "@/test-support/authDoubles.ts";
import { answerAt, NO_RECORDS, SEAT } from "@/test-support/subjectFixtures.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import { SITE_CACHE_TAG } from "@/core/siteCache.ts";

import type { SessionRow } from "@/test-support/authDoubles.ts";
import type { LookupFixture } from "@/test-support/subjectFixtures.ts";
import type { MemoryDB } from "better-auth/adapters/memory";

/** What the request a case arrives as carries, which `arriveAs` sets. */
let requestHeaders: Headers | undefined;

const HEADERS_DOUBLE = { headers: () => Promise.resolve(requestHeaders) };

const LOGGING_DOUBLE = { logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } };

const ADAPTER_DOUBLE = {
  mongodbAdapter: () => insertOrderedAdapter(store as unknown as MemoryDB),
};

const mail = registerAuthDoubles({
  // The admin key the person lane's erasure is sent under, beside the system key the gate reads with.
  core: {
    logging: LOGGING_DOUBLE,
    config: configDouble(GATE_BACKEND_CONFIG, { internalApiKeyAdmin: () => "fabricated-admin-not-a-credential" }),
  },
  specifiers: {
    "next/headers": HEADERS_DOUBLE,
    "next/cache": NEXT_CACHE_DOUBLE,
    "@better-auth/mongo-adapter": ADAPTER_DOUBLE,
  },
});

const store = memoryStore("__flKontoLoeschenStore");

/** What the backend holds for each address the subject read and the gate ask about, a live seat for any other. */
const HELD = new Map<string, LookupFixture>();

/** The counts the erasure answers a person holding one squad row. */
const GELOESCHT = {
  spieler: 1,
  saison_spieler: 1,
  schiedsrichter: 0,
  spiele: 0,
  kontakt_seats: 0,
  registrierungen: 0,
  address_change: 0,
  grants: 0,
  grants_approval_requests: 0,
};

/** What the backend's erasure answers, and every erasure it was asked for, with the actor header each carried. */
let loeschungAnswer: () => Response = () => Response.json(GELOESCHT);
const loeschungen: { method: string; actor: string | null }[] = [];

const LOESCHUNG_PATH = "/api/v0/identity/account/erasure";

const ANSICHT_PATH = "/api/v0/identity/account/erasure/view";

/** Whether the preview reads the press as the last owner's. */
let letzterInhaber = false;

/** The person's own address change, and the method of every request sent to it. */
const ADDRESS_CHANGE_PATH = "/api/v0/account/address_change";
const addressChanges: string[] = [];

/** Every consent save that reached the backend, by its path. */
const consentWrites: string[] = [];

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  if (path.endsWith("/einwilligung")) {
    consentWrites.push(path);
    return Promise.resolve(Response.json({}));
  }
  if (path === ANSICHT_PATH) {
    const leer = { spieler: [], schiedsrichter: [], seats: [], bewerbungen: [], registrierungen: [], address_change: 0 };
    return Promise.resolve(Response.json({ ...leer, verwaltung: "owner", last_owner: letzterInhaber }));
  }
  if (path === LOESCHUNG_PATH) {
    loeschungen.push({ method: init?.method ?? "GET", actor: new Headers(init?.headers).get("x-fl-actor") });
    return Promise.resolve(loeschungAnswer());
  }
  if (path === ADDRESS_CHANGE_PATH) {
    addressChanges.push(init?.method ?? "GET");
    return Promise.resolve(Response.json({ id: "a1", valid_until: "2026-11-05T12:00:00Z", email: "neu@example.org" }));
  }

  const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
  const fixture = HELD.get(email ?? "") ?? { ...NO_RECORDS, seats: [SEAT], account: true };
  return Promise.resolve(Response.json(answerAt(path, fixture)));
}) as typeof globalThis.fetch;

// Imported here rather than at the top: `vi.doMock` reaches only the modules imported after it.
const {
  eraseAccount,
  requestErasure,
  saveBewerbungConsent,
  saveRegistrierungConsent,
  saveSchiedsrichterConsent,
  saveSeatConsent,
  saveSpielerConsent,
  signOutOthers,
  startAddressChange,
  withdrawAddressChange,
} = await import("./personActions.ts");
const { removePasskeyAction } = await import("@/features/passkeys/actions.ts");
const { COPY } = await import("@/core/copy.ts");
const { SERVER_COPY } = await import("@/core/serverCopy.ts");
const { auth } = await import("@/core/auth/library.ts");

beforeEach(() => {
  store.passkey.length = 0;
  store.verification.length = 0;
  cacheCalls.length = 0;
  loeschungen.length = 0;
  addressChanges.length = 0;
  consentWrites.length = 0;
  HELD.clear();
  loeschungAnswer = () => Response.json(GELOESCHT);
  letzterInhaber = false;
});

/** Answers every guard below as one request would: the cookie they read off `headers()`. */
function arriveAs(cookie: string): void {
  requestHeaders = new Headers({ ...ORIGIN, cookie });
}

/** A signed-in person, the request arriving as them, and a deletion link mailed to them; `passkey` adds one they hold. */
async function mitLink(
  email: string,
  { passkey = false }: { passkey?: boolean } = {},
): Promise<{ row: SessionRow; token: string; holder: string }> {
  const { cookie, row } = await sessionByCode(auth, store, email);
  if (passkey) {
    store.passkey.push({
      id: `passkey-${row.userId}`,
      userId: row.userId,
      credentialID: `credential-${row.userId}`,
      publicKey: "k",
      counter: 0,
    });
  }
  arriveAs(cookie);

  const angefordert = await requestErasure({ holder: email });
  expect(angefordert.ok, `the account page's press answered ${JSON.stringify(angefordert)}`).toBe(true);
  const found = /\/erasure\?token=([0-9a-z]+)/.exec(mail.sent.findLast((sent) => sent.to === email)?.text ?? "");
  assert.ok(found?.[1] !== undefined, "the mail carries no link to the page");

  return { row, token: found[1], holder: email };
}

/** What the store still holds of the account `userId` names. */
const heldOf = (userId: string) => ({
  user: store.user.filter((user) => user.id === userId).length,
  passkeys: store.passkey.filter((passkey) => passkey.userId === userId).length,
});

/** Whether the library still holds the link's token, unspent. */
const linkStands = (token: string) => store.verification.some((held) => held.identifier === `delete-account-${token}`);

/** The page the deletion leads to, as Next's redirect names it in what it throws. */
const LEADS_TO_THE_DONE_PAGE = /^NEXT_REDIRECT;[a-z]+;\/erasure\/done;/;

/** Whether a press ended in Next's redirect to the done page, which the action throws rather than answers. */
async function ledToTheDonePage(pressed: Promise<unknown>): Promise<void> {
  const thrown: unknown = await pressed.then(
    () => null,
    (error: unknown) => error,
  );
  const digest = thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "";
  expect(digest, "the press led to no done page").toMatch(LEADS_TO_THE_DONE_PAGE);
}

/** A signed-in owner, the request arriving as their passkey session of this moment, and a link mailed to them. */
async function inhaberinMitLink(email: string): Promise<{ row: SessionRow; token: string; holder: string }> {
  HELD.set(email, {
    ...NO_RECORDS,
    verwaltung: "owner",
    granted_since: "2026-01-01T00:00:00Z",
    inhaber_seit: "2026-01-01T00:00:00Z",
    account: false,
  });
  const durchPasskey = await sessionByCode(auth, store, email);
  madeByPasskey(store, durchPasskey.row);
  arriveAs(durchPasskey.cookie);
  expect((await requestErasure({ holder: email })).ok, "the owner's passkey session mailed no link").toBe(true);
  const found = /\/erasure\?token=([0-9a-z]+)/.exec(mail.sent.findLast((sent) => sent.to === email)?.text ?? "");
  assert.ok(found?.[1] !== undefined, "the mail carries no link to the page");

  return { row: durchPasskey.row, token: found[1], holder: email };
}

// Each a loss nobody would see: an account deleted with its records left, a deletion the cache keeps serving, the last
// owner gone, a link spent by a refusal the person can no longer repair, a passkey holder deleted without the touch.
describe("a person's own account deletion through the mailed link's page", () => {
  it("erases the records under the person's actor, deletes the account, clears the site's tag and leads to the done page", async () => {
    const { row, token, holder } = await mitLink("ganz-weg@example.org");
    // The link's own request cleared it too, mailing being a write.
    cacheCalls.length = 0;

    await ledToTheDonePage(eraseAccount({ token, holder }));

    expect(
      loeschungen.map(({ method, actor }) => [method, actor !== null]),
      "the erasure was not sent once, as a write naming its person",
    ).toStrictEqual([["POST", true]]);
    expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
    expect(cacheCalls.filter(({ name }) => name === "updateTag").flatMap(({ args }) => args)).toStrictEqual([SITE_CACHE_TAG]);
  });

  it("asks a passkey holder signed in by code for the touch, erasing nothing and leaving the link standing", async () => {
    const { row, token, holder } = await mitLink("mit-passkey@example.org", { passkey: true });

    expect(await eraseAccount({ token, holder })).toStrictEqual({ ok: false, reason: COPY.signIn.refusal.touchMissing });
    expect(loeschungen).toStrictEqual([]);
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
    assert.ok(linkStands(token), "the refused press spent the link");
  });

  it("deletes for a passkey holder whose passkey signed in a moment ago", async () => {
    const { row, token, holder } = await mitLink("beruehrt@example.org", { passkey: true });
    madeByPasskey(store, row);

    await ledToTheDonePage(eraseAccount({ token, holder }));
    expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
  });

  it("refuses the league's last owner before the link is spent, and deletes on the same link once another owns", async () => {
    const { row, token, holder } = await inhaberinMitLink("letzte-inhaberin@example.org");
    letzterInhaber = true;

    expect(await eraseAccount({ token, holder })).toStrictEqual({ ok: false, reason: SERVER_COPY.refusalLine.last_owner_erasure });
    expect(loeschungen, "the erasure was asked for although the preview read the last owner").toStrictEqual([]);
    assert.ok(linkStands(token), "the refused press spent the link, which the owner can no longer open");

    letzterInhaber = false;
    await ledToTheDonePage(eraseAccount({ token, holder }));
    expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
  });

  /* The library spends the link before the erasure runs, so a press the backend refuses there can never complete: the
     form left standing would offer a press that ends on the link no longer valid. */
  it("ends a press the backend's erasure refused, its link spent, as the link no longer valid, leading to Konto", async () => {
    const { row, token, holder } = await inhaberinMitLink("zweite-inhaberin@example.org");
    loeschungAnswer = () => Response.json({ error_code: "last_owner_erasure", trace_id: "0".repeat(32) }, { status: 409 });

    expect(await eraseAccount({ token, holder })).toMatchObject({
      ok: true,
      value: { title: COPY.template.linkInvalid, next: { href: "/account/signin" } },
    });
    expect(loeschungen.length, "the backend was never asked, so the refusal proves nothing").toBe(1);
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 1 });
    assert.ok(!linkStands(token), "the library left the link standing, so the case proves nothing about a spent one");
  });

  it("answers a press failing past its spent link with its outcome unknown on the stale-page line", async () => {
    const { token, holder } = await mitLink("unbekannt@example.org");
    loeschungAnswer = () => {
      throw new TypeError("fetch failed");
    };

    expect(await eraseAccount({ token, holder })).toStrictEqual({ ok: false, reason: COPY.shared.failure.stale });
  });

  it("ends a link the library refuses as the link no longer valid, erasing nothing", async () => {
    const { row, holder } = await mitLink("falscher-link@example.org");

    const answer = await eraseAccount({ token: "kein-gemailter-link", holder });

    expect(answer).toMatchObject({ ok: true, value: { title: COPY.template.linkInvalid, sentence: COPY.shared.end.linkInvalid } });
    expect(loeschungen).toStrictEqual([]);
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 0 });
  });

  /* The library reads a barred person's leftover session, or one its account's sessions were ended before, as a session
     like any other: the person lane's own guard is what refuses both. */
  for (const [label, email, judged] of [
    [
      "barred since the link was mailed",
      "gesperrt-seither@example.org",
      () => void HELD.set("gesperrt-seither@example.org", { ...NO_RECORDS, barred: true, account: true }),
    ],
    [
      "ended by its account after it was made",
      "beendet-seither@example.org",
      () => {
        const account = store.user.find((user) => user.email === "beendet-seither@example.org");
        assert.ok(account !== undefined, "the sign-in wrote no account");
        account.sessionsEndedAt = new Date();
      },
    ],
  ] as const) {
    it(`deletes and erases nothing from a session ${label}`, async () => {
      const { row, token, holder } = await mitLink(email);
      judged();

      expect(await eraseAccount({ token, holder })).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
      expect(loeschungen).toStrictEqual([]);
      expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 0 });
    });
  }
});

// Each a loss nobody would see: a passkey holder's address moved or passkey removed by whoever reads their mailbox, an
// administrator's other devices ended from a session that mailbox made, a device left signed in past a list's page.
describe("the account's acts, behind the account's guard and the touch", () => {
  /** A signed-in person holding a passkey, the request arriving as their mailed code's session. */
  async function holderByCode(email: string): Promise<SessionRow> {
    const { cookie, row } = await sessionByCode(auth, store, email);
    store.passkey.push({
      id: `passkey-${row.userId}`,
      userId: row.userId,
      credentialID: `credential-${row.userId}`,
      publicKey: "k",
      counter: 0,
    });
    arriveAs(cookie);
    return row;
  }

  it("refuses a passkey holder signed in by code the address change's start, sending nothing", async () => {
    await holderByCode("start-ohne-touch@example.org");

    expect(await startAddressChange({ email: "neu@example.org", holder: "start-ohne-touch@example.org" })).toStrictEqual({
      ok: false,
      reason: COPY.signIn.refusal.touchMissing,
    });
    expect(addressChanges).toStrictEqual([]);
  });

  it("refuses a passkey holder signed in by code the removal of a passkey, removing nothing", async () => {
    const row = await holderByCode("entfernen-ohne-touch@example.org");

    expect(await removePasskeyAction({ id: `passkey-${row.userId}`, holder: "entfernen-ohne-touch@example.org" })).toStrictEqual({
      ok: false,
      reason: COPY.signIn.refusal.touchMissing,
    });
    expect(heldOf(row.userId).passkeys).toBe(1);
  });

  it("starts the change for a passkey holder whose passkey signed in a moment ago", async () => {
    const row = await holderByCode("start-mit-touch@example.org");
    madeByPasskey(store, row);

    expect(await startAddressChange({ email: "neu@example.org", holder: "start-mit-touch@example.org" })).toStrictEqual({
      ok: true,
      value: undefined,
    });
    expect(addressChanges).toStrictEqual(["POST"]);
  });

  /* The person guard admits an address holding a grant on its mailed code alone, reporting it no administrator: the
     account's acts are the administrator's lane's to admit. */
  it("refuses an administrator's session made by a mailed code alone every untouched act of the account", async () => {
    const email = "verwalterin-per-code@example.org";
    HELD.set(email, { ...NO_RECORDS, verwaltung: "administration", granted_since: "2026-01-01T00:00:00Z", inhaber_seit: null, account: false });
    const { cookie, row } = await sessionByCode(auth, store, email);
    const other = { ...row, id: `other-${row.id}`, token: `other-${row.token}` };
    store.session.push(other);
    arriveAs(cookie);
    const mailed = mail.sent.length;

    expect(await signOutOthers({ holder: email })).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    expect(await requestErasure({ holder: email })).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    assert.ok(store.session.includes(other), "the mailbox's session ended the administrator's other device");
    expect(mail.sent.length, "the mailbox's session had a deletion link mailed").toBe(mailed);
  });

  /* Deine Einträge's saves are the account's too: on the person lane alone, the mailbox's session would change the
     administrator's consents, the page alone refusing it. */
  it("refuses an administrator's session made by a mailed code alone every consent save, sending none", async () => {
    const email = "verwalterin-einwilligung@example.org";
    HELD.set(email, { ...NO_RECORDS, verwaltung: "administration", granted_since: "2026-01-01T00:00:00Z", inhaber_seit: null, account: false });
    const { cookie } = await sessionByCode(auth, store, email);
    arriveAs(cookie);

    for (const save of [saveSpielerConsent, saveSchiedsrichterConsent, saveRegistrierungConsent, saveSeatConsent, saveBewerbungConsent]) {
      const posted = new FormData();
      posted.set("holder", email);
      expect(await save(posted)).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    }
    expect(consentWrites, "the mailbox's session sent a consent save").toStrictEqual([]);
  });

  /* A tab drawn for one account, the browser signed in as another since: the act would run as the second account and
     report success on the first one's page. */
  it("refuses every untouched act posted from a page drawn for another address, ending and mailing nothing", async () => {
    const { cookie, row } = await sessionByCode(auth, store, "jetzt-angemeldet@example.org");
    const other = { ...row, id: `other-${row.id}`, token: `other-${row.token}` };
    store.session.push(other);
    arriveAs(cookie);
    const mailed = mail.sent.length;
    const stale = { holder: "frueher-angemeldet@example.org" };

    expect(await signOutOthers(stale)).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    expect(await requestErasure(stale)).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    expect(await withdrawAddressChange(stale)).toStrictEqual({ ok: false, reason: COPY.shared.failure.signInExpired });
    assert.ok(store.session.includes(other), "the stale page ended the signed-in account's other device");
    expect(mail.sent.length, "the stale page had a deletion link mailed").toBe(mailed);
    expect(addressChanges, "the stale page withdrew the signed-in account's change").toStrictEqual([]);
  });

  it("ends every other session of the account however many stand, and keeps this one", async () => {
    const { cookie, row } = await sessionByCode(auth, store, "viele-geraete@example.org");
    for (let index = 0; index < 120; index += 1) store.session.push({ ...row, id: `device-${String(index)}`, token: `token-${String(index)}` });
    arriveAs(cookie);

    expect(await signOutOthers({ holder: "viele-geraete@example.org" })).toStrictEqual({ ok: true, value: undefined });
    expect(store.session.filter((session) => session.userId === row.userId)).toStrictEqual([row]);
  });
});
