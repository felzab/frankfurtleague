import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
  asDataUrl,
  configDouble,
  GATE_BACKEND_CONFIG,
  insertOrderedAdapter,
  memoryStore,
  ORIGIN,
  registerAuthDoubles,
  sessionByCode,
} from "@/core/authDoubles.ts";
import { answerAt, NO_RECORDS } from "@/core/subjectFixtures.ts";
import { NEXT_CACHE_DOUBLE } from "@/shared/testing/actionDoubles.ts";

import type { SessionRow } from "@/core/authDoubles.ts";
import type { MemoryDB } from "better-auth/adapters/memory";

/* The account page's three address writes over the real person spine and the real sign-in store: the
   backend and the mailer are the doubles. */
let requestHeaders: Headers | undefined;

const mail = registerAuthDoubles({
  core: {
    logging: { logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } },
    config: configDouble(GATE_BACKEND_CONFIG, { internalApiKeyAdmin: () => "fabricated-admin-not-a-credential" }),
  },
  specifiers: {
    "next/headers": { headers: () => Promise.resolve(requestHeaders) },
    "next/cache": asDataUrl(NEXT_CACHE_DOUBLE),
    "@better-auth/mongo-adapter": { mongodbAdapter: () => insertOrderedAdapter(store as unknown as MemoryDB) },
  },
});

const store = memoryStore("__flAdresswechselStore");

const BISHER = "lena@schule.example";
const NEU = "lena@neu.example";
const CARRIER = "6890a1b2c3d4e5f607800002";

const ADRESSWECHSEL = "/api/v0/konto/adresswechsel";
const FREIGABE = "/api/v0/konto/adresswechsel/freigabe";

type Art = "spieler" | "schiedsrichter";
let art: Art = "spieler";
let startAnswer: () => Response;
const writes: { method: string; path: string; body: unknown; actor: boolean }[] = [];

const mint = () => ({
  acknowledged: 1,
  art: art,
  id: CARRIER,
  token: "neu-token",
  stopp_token: "stopp-token",
  gueltig_bis: "2026-10-21T11:30:00Z",
  email: NEU,
  bisherige_email: BISHER,
  vorname: "Lena",
});

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  const method = init?.method ?? "GET";
  if (path.startsWith("/api/v0/zustellung")) return Promise.resolve(Response.json({ acknowledged: 1, angewendet: true }));
  if (path === ADRESSWECHSEL || path === FREIGABE) {
    writes.push({
      method: method,
      path: path,
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      actor: new Headers(init?.headers).get("x-fl-actor") !== null,
    });
    if (path === FREIGABE) {
      return Promise.resolve(
        Response.json({ acknowledged: 1, art: art, id: CARRIER, token: "frei-token", gueltig_bis: "2026-10-21T11:30:00Z", email: NEU }),
      );
    }
    if (method === "DELETE") return Promise.resolve(Response.json({ acknowledged: 1, moeglich: true, bleibt_verwaltung: false, offen: null }));
    return Promise.resolve(startAnswer());
  }

  const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
  return Promise.resolve(
    Response.json(answerAt(path, { acknowledged: 1, ...NO_RECORDS, spieler: [{ spieler_id: CARRIER }], konto: email !== undefined })),
  );
}) as typeof globalThis.fetch;

// Imported here rather than at the top: a static import resolves before the hooks above are registered.
const { starteAdresswechselAction, gibAdresswechselFreiAction, stoppeAdresswechselAction } = await import("./personActions.ts");
const { stepUpRequired } = await import("@/shared/utils/adminMutation.ts");
const { adresswechselLink } = await import("@/core/adresswechselEmail.ts");
const { auth } = await import("@/core/auth.ts");

/** A person signed in by a code just now, the request arriving as them. */
async function angemeldet(): Promise<SessionRow> {
  const { cookie, row } = await sessionByCode(auth, store, BISHER);
  requestHeaders = new Headers({ ...ORIGIN, cookie });
  return row;
}

const an = (to: string) => mail.sent.filter((sent) => sent.to === to);

beforeEach(() => {
  writes.length = 0;
  mail.sent.length = 0;
  mail.answerWith(() => "accepted");
  art = "spieler";
  startAnswer = () => Response.json(mint());
});

describe("the person's own start of an address change", () => {
  it("sends the new address under the person's actor, mails the link to it and the stop link to the address signed in", async () => {
    await angemeldet();

    const answer = await starteAdresswechselAction({ email: NEU });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(writes, [{ method: "POST", path: ADRESSWECHSEL, body: { email: NEU }, actor: true }]);
    assert.ok(
      an(NEU)[0]?.text.includes(adresswechselLink("http://localhost:3000", "spieler", "neu-token")),
      "the new address got no link to its page",
    );
    assert.ok(
      an(BISHER)[0]?.text.includes(adresswechselLink("http://localhost:3000", "spieler", "stopp-token")),
      "the address signed in got no stop link",
    );
  });

  /* The answer reaches the browser: neither token, nor either address, ever does. */
  it("answers the browser one sentence carrying no token and no address", async () => {
    await angemeldet();

    const answer = JSON.stringify(await starteAdresswechselAction({ email: NEU }));

    assert.doesNotMatch(answer, /token|neu\.example|schule\.example/);
    assert.match(answer, /Bestätige die neue Adresse über den Link in der E-Mail an sie, bis 21\. Oktober 2026 um 13:30\./);
  });

  /* Telling the person their new address is barred would answer a stranger typing it whether an address is known here. */
  it("answers a link the ban list kept back in the words of one that went", async () => {
    await angemeldet();
    const gesendet = await starteAdresswechselAction({ email: NEU });
    mail.answerWith(({ to }) => (to === NEU ? "barred" : "accepted"));
    const gesperrt = await starteAdresswechselAction({ email: NEU });

    assert.deepEqual(gesperrt, gesendet);
  });

  it("puts the link on the referee's page where a referee row carries the change", async () => {
    art = "schiedsrichter";
    await angemeldet();

    await starteAdresswechselAction({ email: NEU });

    assert.ok(an(NEU)[0]?.text.includes(adresswechselLink("http://localhost:3000", "schiedsrichter", "neu-token")));
  });

  /* An address change outlives the session making it, as a passkey does: past the enrolment window the page asks first. */
  it("asks for a confirmation first from a sign-in older than the enrolment window, sending and mailing nothing", async () => {
    const row = await angemeldet();
    row.createdAt = new Date(Date.now() - 10 * 60 * 1000);

    assert.deepEqual(await starteAdresswechselAction({ email: NEU }), stepUpRequired());
    assert.deepEqual(writes, []);
    assert.deepEqual(mail.sent, []);
  });

  it("puts the address already signed in with on the box", async () => {
    await angemeldet();
    startAnswer = () => Response.json({ error_code: "REQ-SPIELER-007", trace_id: "0".repeat(32) }, { status: 409 });

    const answer = await starteAdresswechselAction({ email: BISHER });

    assert.equal(answer.success ? undefined : answer.fieldErrors?.email, "Mit dieser Adresse bist Du schon angemeldet.");
    assert.deepEqual(mail.sent, []);
  });
});

describe("the approval and the stop on the account page", () => {
  /* The notice with its stop link went out at the start: the approval mails the new address alone. */
  it("approves under the person's actor and mails the link to the new address alone", async () => {
    await angemeldet();

    const answer = await gibAdresswechselFreiAction();

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(writes, [{ method: "POST", path: FREIGABE, body: null, actor: true }]);
    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      [NEU],
    );
  });

  it("asks for a confirmation first before an approval from an old sign-in", async () => {
    const row = await angemeldet();
    row.createdAt = new Date(Date.now() - 10 * 60 * 1000);

    assert.deepEqual(await gibAdresswechselFreiAction(), stepUpRequired());
    assert.deepEqual(writes, []);
  });

  /* A stop hands nothing over, so even an old sign-in may make it. */
  it("stops from an old sign-in too, mailing nobody", async () => {
    const row = await angemeldet();
    row.createdAt = new Date(Date.now() - 10 * 60 * 1000);

    const answer = await stoppeAdresswechselAction();

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(
      writes.map(({ method, path }) => [method, path]),
      [["DELETE", ADRESSWECHSEL]],
    );
    assert.deepEqual(mail.sent, []);
  });
});
