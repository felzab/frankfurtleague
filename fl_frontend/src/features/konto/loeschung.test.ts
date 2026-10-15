import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  ADMIN_EMAIL,
  asDataUrl,
  configDouble,
  GATE_BACKEND_CONFIG,
  insertOrderedAdapter,
  madeByPasskey,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  sessionByCode,
} from "@/core/authDoubles.ts";
import { answerAt, NO_RECORDS, SITZ } from "@/core/subjectFixtures.ts";
import { cacheCalls, NEXT_CACHE_DOUBLE } from "@/shared/testing/actionDoubles.ts";

import type { SessionRow } from "@/core/authDoubles.ts";
import type { LookupFixture } from "@/core/subjectFixtures.ts";
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
    "next/cache": asDataUrl(NEXT_CACHE_DOUBLE),
    "@better-auth/mongo-adapter": ADAPTER_DOUBLE,
  },
});

const store = memoryStore("__flLoeschungStore");

/** What the backend holds for each address the subject read and the gate ask about, a live seat for any other. */
const HELD = new Map<string, LookupFixture>();

/** The counts the erasure answers a person holding one squad row. */
const ERASED = {
  acknowledged: 1,
  spieler: 1,
  saison_spieler: 1,
  schiedsrichter: 0,
  spiele: 0,
  kontakt_sitze: 0,
  registrierungen: 0,
  adresswechsel: 0,
  drosselung: 0,
};

/** What the backend's erasure answers, and every erasure it was asked for, with the actor header each carried. */
let erasureAnswer: () => Response = () => Response.json(ERASED);
const erasures: { method: string; actor: string | null }[] = [];

const ERASURE_PATH = "/api/v0/identitaet/selbst/erasure";

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  if (path === ERASURE_PATH) {
    erasures.push({ method: init?.method ?? "GET", actor: new Headers(init?.headers).get("x-fl-actor") });
    return Promise.resolve(erasureAnswer());
  }

  const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
  const fixture = HELD.get(email ?? "") ?? { ...NO_RECORDS, sitze: [SITZ], konto: true };
  return Promise.resolve(Response.json(answerAt(path, { acknowledged: 1, ...fixture })));
}) as typeof globalThis.fetch;

// Imported here rather than at the top: a static import resolves before the hooks above are registered.
const { fordereKontoLoeschungAnAction } = await import("./actions.ts");
const { loescheKontoAction } = await import("./personActions.ts");
const { KONTO_FORBIDDEN } = await import("@/shared/utils/kontoMutation.ts");
const { auth } = await import("@/core/auth.ts");

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  store.passkey.length = 0;
  store.verification.length = 0;
  cacheCalls.length = 0;
  erasures.length = 0;
  HELD.clear();
  erasureAnswer = () => Response.json(ERASED);
});

/** Answers every guard below as one request would: the cookie they read off `headers()`. */
function arriveAs(cookie: string): void {
  requestHeaders = new Headers({ ...ORIGIN, cookie });
}

/** A signed-in person holding a passkey, the request arriving as them, and a deletion link mailed to them. */
async function mitLink(email: string): Promise<{ row: SessionRow; token: string }> {
  const { cookie, row } = await sessionByCode(auth, store, email);
  store.passkey.push({ id: `passkey-${row.userId}`, userId: row.userId, credentialID: `credential-${row.userId}`, publicKey: "k", counter: 0 });
  arriveAs(cookie);

  const angefordert = await fordereKontoLoeschungAnAction();
  assert.equal(angefordert.success, true, `the account page's press answered ${JSON.stringify(angefordert)}`);
  const found = /\/loeschung\?token=([0-9a-z]+)/.exec(mail.sent.findLast((sent) => sent.to === email)?.text ?? "");
  assert.ok(found?.[1] !== undefined, "the mail carries no link to the interstitial");

  return { row, token: found[1] };
}

/** What the store still holds of the account `userId` names. */
const heldOf = (userId: string) => ({
  user: store.user.filter((user) => user.id === userId).length,
  passkeys: store.passkey.filter((passkey) => passkey.userId === userId).length,
});

describe("a person's own account deletion, from the account page's press to the interstitial's", () => {
  it("erases the records under the person's actor, then deletes the account, and drops both base tags", async () => {
    const { row, token } = await mitLink("ganz-weg@example.org");

    const answer = await loescheKontoAction(token);

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(
      erasures.map(({ method, actor }) => [method, actor !== null]),
      [["POST", true]],
      "the erasure was not sent once, as a write naming its person",
    );
    assert.deepEqual(heldOf(row.userId), { user: 0, passkeys: 0 });
    assert.deepEqual(
      cacheCalls.filter(({ name }) => name === "updateTag").flatMap(({ args }) => args),
      ["spieler", "spiele"],
    );
  });

  /* Asked and refused: a case passing where the hook never ran would leave the same rows standing. */
  it("leaves the account and its passkeys where the backend refuses the erasure, having asked it, in the refusal's own words", async () => {
    const { row, token } = await mitLink("verweigert@example.org");
    // A ban entered since the spine judged the session, which the person route asks again.
    erasureAnswer = () => Response.json({ error_code: "REQ-AUTH-008", trace_id: "0".repeat(32) }, { status: 403 });

    const answer = await loescheKontoAction(token);

    assert.equal(erasures.length, 1, "the backend was never asked, so the refusal proves nothing");
    assert.match(answer.success ? "" : answer.error, /Diese E-Mail-Adresse ist gesperrt/);
    assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
  });

  /* The library reads a barred person's leftover session, or one its account's sessions were ended before, as
     a session like any other: the person spine's own judgement is what refuses both. */
  for (const [label, email, judged] of [
    [
      "barred since the link was mailed",
      "gesperrt-seither@example.org",
      () => void HELD.set("gesperrt-seither@example.org", { ...NO_RECORDS, gesperrt: true, konto: true }),
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
      const { row, token } = await mitLink(email);
      judged();

      assert.deepEqual(await loescheKontoAction(token), { success: false, error: KONTO_FORBIDDEN });
      assert.deepEqual(erasures, []);
      assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
    });
  }

  /* An address holding a grant deletes only from the session its administrator's lane admits, as its own
     account page is drawn only for one: the link its passkey session asked for, pressed from its mailbox's. */
  it("deletes and erases nothing from an administrator's session the mailbox alone made", async () => {
    HELD.set(ADMIN_EMAIL, { ...NO_RECORDS, verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z", konto: false });
    const durchPasskey = await sessionByCode(auth, store, ADMIN_EMAIL);
    madeByPasskey(store, durchPasskey.row);
    arriveAs(durchPasskey.cookie);
    assert.equal((await fordereKontoLoeschungAnAction()).success, true, "the administrator's passkey session mailed no link");
    const found = /\/loeschung\?token=([0-9a-z]+)/.exec(mail.sent.findLast((sent) => sent.to === ADMIN_EMAIL)?.text ?? "");
    assert.ok(found?.[1] !== undefined, "the mail carries no link to the interstitial");

    arriveAs((await sessionByCode(auth, store, ADMIN_EMAIL)).cookie);

    assert.deepEqual(await loescheKontoAction(found[1]), { success: false, error: KONTO_FORBIDDEN });
    assert.deepEqual(erasures, []);
    assert.deepEqual(heldOf(durchPasskey.row.userId), { user: 1, passkeys: 1 });
  });

  it("refuses a link the library refuses, in words naming the fresh one, erasing nothing", async () => {
    const { row } = await mitLink("falscher-link@example.org");

    const answer = await loescheKontoAction("kein-gemailter-link");

    assert.match(answer.success ? "" : answer.error, /Fordere auf Deiner Kontoseite einen neuen an\./);
    assert.deepEqual(erasures, []);
    assert.deepEqual(heldOf(row.userId), { user: 1, passkeys: 1 });
  });

  /* The link goes to the session's own mailbox, so a session past the step-up window still asks for one
     (`docs/frontend/spec.md :: I676`). */
  it("mails the link from a session signed in past the step-up window", async () => {
    const { cookie, row } = await sessionByCode(auth, store, "spaeter@example.org");
    row.createdAt = new Date(Date.now() - 3 * HOUR_MS);
    arriveAs(cookie);

    assert.equal((await fordereKontoLoeschungAnAction()).success, true);
    assert.ok(
      mail.sent.some((sent) => sent.to === "spaeter@example.org"),
      "no link was mailed",
    );
  });
});
