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
import { serveBackend } from "@/test-support/backend.ts";
import { answerAt, NO_RECORDS, SEAT } from "@/test-support/subjectFixtures.ts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import { SITE_CACHE_TAG } from "@/core/siteCache.ts";

import type { SessionRow } from "@/test-support/authDoubles.ts";
import type { LookupFixture } from "@/test-support/subjectFixtures.ts";
import type { MemoryDB } from "better-auth/adapters/memory";

/** What the request a case arrives as carries, which `arriveAs` sets. */
let requestHeaders: Headers | undefined;

/** Every cookie an action deleted since the case began, as it named the cookie to Next. */
const deletedCookies: unknown[] = [];

const HEADERS_DOUBLE = {
  headers: () => Promise.resolve(requestHeaders),
  cookies: () => Promise.resolve({ delete: (cookie: unknown) => void deletedCookies.push(cookie) }),
};

/** The mailed link's cookie as the proxy set it on the deletion's page, which a completed deletion forgets. */
const ERASURE_LINK_COOKIE = { name: "mailed_link", path: "/erasure" };

const ADAPTER_DOUBLE = {
  mongodbAdapter: () => insertOrderedAdapter(store as unknown as MemoryDB),
};

const mail = registerAuthDoubles({
  // The admin key the person lane's erasure is sent under, beside the system key the gate reads with.
  core: {
    config: configDouble(GATE_BACKEND_CONFIG, { internalApiKeyAdmin: () => "fabricated-admin-not-a-credential" }),
  },
  specifiers: {
    "next/headers": HEADERS_DOUBLE,
    "next/cache": NEXT_CACHE_DOUBLE,
    "@better-auth/mongo-adapter": ADAPTER_DOUBLE,
  },
});

const store = memoryStore("__flAccountErasureStore");

/** What the backend holds for each address the subject read and the gate ask about, a live seat for any other. */
const HELD = new Map<string, LookupFixture>();

/** Every erasure the backend was asked for, with the actor header each carried. */
const erasures: { method: string; actor: string | null }[] = [];

const ERASURE_PATH = "/api/v0/identity/account/erasure";

/** The person's own address change, and the method of every request sent to it. */
const ADDRESS_CHANGE_PATH = "/api/v0/account/address_change";
const addressChanges: string[] = [];

/** Every consent save that reached the backend, by its path. */
const consentWrites: string[] = [];

serveBackend(({ method, path: endpoint, headers, body }) => {
  // Under the base path the client sends it on, as the cases spell every path they compare.
  const path = `/api/v0${endpoint}`;
  if (path.endsWith("/einwilligung")) {
    consentWrites.push(path);
    return {};
  }
  if (path === ERASURE_PATH) {
    erasures.push({ method, actor: headers.get("x-fl-actor") });
    return new Response(null, { status: 204 });
  }
  if (path === ADDRESS_CHANGE_PATH) {
    addressChanges.push(method);
    return { id: "a1", valid_until: "2026-11-05T12:00:00Z", email: "neu@example.org" };
  }

  const { email } = (body ?? {}) as { email?: string };
  const fixture = HELD.get(email ?? "") ?? { ...NO_RECORDS, seats: [SEAT], account: true };
  return answerAt(path, fixture);
});

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
  withdrawAddressChange,
} = await import("./personActions.ts");
const { COPY } = await import("@/core/copy.ts");
const { SERVER_COPY } = await import("@/core/serverCopy.ts");
const { auth } = await import("@/core/auth/library.ts");

beforeEach(() => {
  store.passkey.length = 0;
  store.verification.length = 0;
  cacheCalls.length = 0;
  deletedCookies.length = 0;
  erasures.length = 0;
  addressChanges.length = 0;
  consentWrites.length = 0;
  HELD.clear();
});

/** Answers every guard below as one request would: the cookie they read off `headers()`. */
function arriveAs(cookie: string): void {
  requestHeaders = new Headers({ ...ORIGIN, cookie });
}

/** A signed-in person, the request arriving as them, and a deletion link mailed to them. */
async function withLink(email: string): Promise<{ row: SessionRow; token: string; holder: string }> {
  const { cookie, row } = await sessionByCode(auth, store, email);
  arriveAs(cookie);

  const requested = await requestErasure({ holder: email });
  expect(requested.ok, `the account page's press answered ${JSON.stringify(requested)}`).toBe(true);
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
async function ownerWithLink(email: string): Promise<{ row: SessionRow; token: string; holder: string }> {
  HELD.set(email, {
    ...NO_RECORDS,
    admin_tier: "owner",
    granted_since: "2026-01-01T00:00:00Z",
    account: false,
  });
  const byPasskey = await sessionByCode(auth, store, email);
  madeByPasskey(store, byPasskey.row);
  arriveAs(byPasskey.cookie);
  expect((await requestErasure({ holder: email })).ok, "the owner's passkey session mailed no link").toBe(true);
  const found = /\/erasure\?token=([0-9a-z]+)/.exec(mail.sent.findLast((sent) => sent.to === email)?.text ?? "");
  assert.ok(found?.[1] !== undefined, "the mail carries no link to the page");

  return { row: byPasskey.row, token: found[1], holder: email };
}

// Each a loss nobody would see: an account deleted with its records left, a deletion the cache keeps serving, the last
// owner gone, a link spent by a refusal the person can no longer repair, a used link left in a shared browser.
describe("a person's own account deletion through the mailed link's page", () => {
  it("erases the records under the person's actor, deletes the account, clears the site's tag and leads to the done page", async () => {
    const { row, token, holder } = await withLink("ganz-weg@example.org");
    // The link's own request cleared it too, mailing being a write.
    cacheCalls.length = 0;

    await ledToTheDonePage(eraseAccount({ token, holder }));

    expect(
      erasures.map(({ method, actor }) => [method, actor !== null]),
      "the erasure was not sent once, as a write naming its person",
    ).toStrictEqual([["POST", true]]);
    expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
    expect(cacheCalls.filter(({ name }) => name === "updateTag").flatMap(({ args }) => args)).toStrictEqual([SITE_CACHE_TAG]);
    expect(deletedCookies, "the used link stayed in the browser for its hour").toStrictEqual([ERASURE_LINK_COOKIE]);
    // Mailed nowhere, a person would never learn their account went.
    expect(mail.owed.at(-1)?.data).toStrictEqual({ kind: "deletion_notice", saison_id: null });
  });

  it("refuses the league's owner before the link is spent, and deletes on the same link after a handover", async () => {
    const email = "letzte-inhaberin@example.org";
    const { row, token, holder } = await ownerWithLink(email);

    expect(await eraseAccount({ token, holder })).toStrictEqual({ ok: false, reason: SERVER_COPY.refusalLine.owner_erasure });
    expect(erasures, "the erasure was asked for although the subject read the owner").toStrictEqual([]);
    assert.ok(linkStands(token), "the refused press spent the link, which the owner can no longer open");

    HELD.set(email, { ...NO_RECORDS, seats: [SEAT], account: true });
    await ledToTheDonePage(eraseAccount({ token, holder }));
    expect(heldOf(row.userId)).toStrictEqual({ user: 0, passkeys: 0 });
    expect(deletedCookies, "the refused press forgot the link, or the completed one kept it").toStrictEqual([ERASURE_LINK_COOKIE]);
  });

  it("ends a link the library refuses as the link no longer valid, erasing nothing", async () => {
    const { row, holder } = await withLink("falscher-link@example.org");

    const answer = await eraseAccount({ token: "no-mailed-link", holder });

    expect(answer).toMatchObject({ ok: true, value: { title: COPY.template.linkInvalid } });
    expect(erasures).toStrictEqual([]);
    expect(heldOf(row.userId)).toStrictEqual({ user: 1, passkeys: 0 });
  });
});

// Each a loss nobody would see: an administrator's other devices ended from a session a mailbox made, a device left
// signed in past a list's page.
describe("the account's acts, behind the account's guard", () => {
  /* The person guard admits an address holding a grant on its mailed code alone, reporting it no administrator: the
     account's acts are the administrator's lane's to admit. */
  it("refuses an administrator's session made by a mailed code alone every untouched act of the account", async () => {
    const email = "verwalterin-per-code@example.org";
    HELD.set(email, { ...NO_RECORDS, admin_tier: "administration", granted_since: "2026-01-01T00:00:00Z", account: false });
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
    HELD.set(email, { ...NO_RECORDS, admin_tier: "administration", granted_since: "2026-01-01T00:00:00Z", account: false });
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
