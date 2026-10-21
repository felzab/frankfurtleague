import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import {
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
import { answerAt, NO_RECORDS } from "@/core/subjectFixtures.ts";
import { cacheCalls, NEXT_CACHE_DOUBLE } from "@/shared/testing/actionDoubles.ts";

import type { SessionRow } from "@/core/authDoubles.ts";
import type { MemoryDB } from "better-auth/adapters/memory";

/* The account page's three address writes over the real person spine and the real sign-in store: the
   backend and the mailer are the doubles. */
let requestHeaders: Headers | undefined;

/** Work the real `after` would run behind the response, collected rather than run: no case here has a response. */
const deferred: (() => unknown)[] = [];

const mail = registerAuthDoubles({
  core: {
    logging: { logger: { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined } },
    config: configDouble(GATE_BACKEND_CONFIG, { internalApiKeyAdmin: () => "fabricated-admin-not-a-credential" }),
  },
  specifiers: {
    "next/headers": { headers: () => Promise.resolve(requestHeaders) },
    "next/cache": asDataUrl(NEXT_CACHE_DOUBLE),
    "next/server": { after: (task: () => unknown) => void deferred.push(task) },
    "@better-auth/mongo-adapter": { mongodbAdapter: () => insertOrderedAdapter(store as unknown as MemoryDB) },
  },
});

const store = memoryStore("__flAdresswechselStore");

const BISHER = "lena@schule.example";
const NEU = "lena@neu.example";
const CARRIER = "6890a1b2c3d4e5f607800002";

const ADRESSWECHSEL = "/api/v0/konto/adresswechsel";
/** The grants' outbox, which tells an address change's approvers (`docs/backend/spec.md :: I862`). */
const ABGLEICH = "/api/v0/berechtigungen/abgleich";
let abgleiche = 0;
const FREIGABE = "/api/v0/konto/adresswechsel/freigabe";

/** How many are told an approval waits: none for an address holding no grant. */
let genehmigerAnzahl = 0;
/** The grant the signed-in address holds, as the subject read serves it: none, unless a case names its tier. */
let grant: { verwaltung: "owner" | "administration"; berechtigt_seit: string; inhaber_seit: string | null } | null = null;
let startAnswer: () => Response;
let freigabeAnswer: () => Response;
let stoppAnswer: () => Response;
const writes: { method: string; path: string; body: unknown; actor: boolean }[] = [];

const mint = () => ({
  acknowledged: 1,
  id: CARRIER,
  token: "neu-token",
  stopp_token: "stopp-token",
  gueltig_bis: "2026-10-21T11:30:00Z",
  email: NEU,
  bisherige_email: BISHER,
  vorname: "Lena",
  genehmiger_anzahl: genehmigerAnzahl,
});

globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
  const method = init?.method ?? "GET";
  if (path.startsWith("/api/v0/zustellung")) return Promise.resolve(Response.json({ acknowledged: 1, angewendet: true }));
  if (path === ABGLEICH) {
    abgleiche += 1;
    return Promise.resolve(
      Response.json({ acknowledged: 1, beanspruchung: null, beansprucht_bis: null, aenderungen: [], empfaenger: [], uebersprungen: 0 }),
    );
  }
  if (path === ADRESSWECHSEL || path === FREIGABE) {
    writes.push({
      method: method,
      path: path,
      body: init?.body === undefined ? null : JSON.parse(String(init.body)),
      actor: new Headers(init?.headers).get("x-fl-actor") !== null,
    });
    if (path === FREIGABE) return Promise.resolve(freigabeAnswer());
    if (method === "DELETE") return Promise.resolve(stoppAnswer());
    return Promise.resolve(startAnswer());
  }

  const { email } = JSON.parse(String(init?.body ?? "{}")) as { email?: string };
  return Promise.resolve(
    Response.json(
      answerAt(path, { acknowledged: 1, ...NO_RECORDS, spieler: [{ spieler_id: CARRIER }], konto: email !== undefined, ...(grant ?? {}) }),
    ),
  );
}) as typeof globalThis.fetch;

// Imported here rather than at the top: a static import resolves before the hooks above are registered.
const { starteAdresswechselAction, gibAdresswechselFreiAction, stoppeAdresswechselAction } = await import("./personActions.ts");
const { stepUpRequired } = await import("@/shared/utils/adminMutation.ts");
const { adresswechselLink } = await import("@/core/adresswechselEmail.ts");
const { auth } = await import("@/core/auth.ts");
const { mapKontoAdresswechselRefusal, mapKontoFreigabeRefusal, mapKontoStoppRefusal } = await import("@/features/adresswechsel/refusals.ts");
const { assertEachAnswered, refusedOn } = await import("@/shared/testing/publishedRefusals.ts");

/** A grant holder signed in just now, by the passkey the administrator's guard asks of them. */
async function verwaltendAngemeldet(): Promise<void> {
  madeByPasskey(store, await angemeldet());
}

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
  genehmigerAnzahl = 0;
  grant = null;
  deferred.length = 0;
  abgleiche = 0;
  startAnswer = () => Response.json(mint());
  freigabeAnswer = () => Response.json({ acknowledged: 1, id: CARRIER, token: "frei-token", gueltig_bis: "2026-10-21T11:30:00Z", email: NEU });
  stoppAnswer = () => Response.json({ acknowledged: 1, moeglich: true, offen: null });
  cacheCalls.length = 0;
});

/** The backend's own window refusing a press the page's check admitted at the window's edge. */
const unbestaetigt = () => Response.json({ error_code: "REQ-AUTH-009", trace_id: "0".repeat(32) }, { status: 401 });

describe("the person's own start of an address change", () => {
  it("sends the new address under the person's actor, mails the link to it and the stop link to the address signed in", async () => {
    await angemeldet();

    const answer = await starteAdresswechselAction({ email: NEU });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(writes, [{ method: "POST", path: ADRESSWECHSEL, body: { email: NEU }, actor: true }]);
    assert.ok(an(NEU)[0]?.text.includes(adresswechselLink("http://localhost:3000", "neu-token")), "the new address got no link to its page");
    assert.ok(
      an(BISHER)[0]?.text.includes(adresswechselLink("http://localhost:3000", "stopp-token")),
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

  /* A grant moves only once another administrator approves: the approvers are told once, by the grants' outbox the
     start queued, and the person that the old address signs in meanwhile. */
  it("leaves the approvers to the grants' outbox, drained behind the answer, and tells the person the old address signs in meanwhile", async () => {
    genehmigerAnzahl = 2;
    grant = { verwaltung: "administration", berechtigt_seit: "2026-01-01T00:00:00Z", inhaber_seit: null };
    await verwaltendAngemeldet();

    const answer = await starteAdresswechselAction({ email: NEU });

    assert.deepEqual(
      ["anna@verwaltung.example", "ben@verwaltung.example"].flatMap((to) => an(to)),
      [],
      "the action mailed an approver whom the outbox mails too",
    );
    assert.equal(deferred.length, 1, "the start scheduled other work behind the answer than the outbox's drain");
    for (const task of deferred) await task();
    assert.equal(abgleiche, 1, "the outbox holding the approvers' notice was not drained");
    assert.match(
      answer.success ? (answer.message ?? "") : "",
      /muss außerdem eine andere Person aus der Verwaltung zustimmen\. Bis dahin meldest Du Dich weiter mit dieser Adresse an\./,
    );
  });

  /* An owner told that any administrator may approve asks one, whose press is closed: the tier names the approver. */
  it("names another owner as the approver where the moved grant is an owner's", async () => {
    genehmigerAnzahl = 1;
    grant = { verwaltung: "owner", berechtigt_seit: "2026-01-01T00:00:00Z", inhaber_seit: "2026-01-01T00:00:00Z" };
    await verwaltendAngemeldet();

    const answer = await starteAdresswechselAction({ email: NEU });

    assert.match(
      answer.success ? (answer.message ?? "") : "",
      /muss außerdem eine andere Inhaberin oder ein anderer Inhaber der Verwaltung zustimmen\./,
    );
  });

  it("mails no approver where the address holds no grant", async () => {
    await angemeldet();

    const answer = await starteAdresswechselAction({ email: NEU });

    assert.deepEqual(mail.sent.map(({ to }) => to).sort(), [BISHER, NEU].sort());
    assert.deepEqual(deferred, [], "a start moving no grant drained the grants' outbox");
    assert.doesNotMatch(answer.success ? (answer.message ?? "") : "", /Verwaltung/);
  });

  /* The page then shows the change and its withdrawal alone, so the repair named is the one it offers. */
  it("answers a link that did not leave with the withdrawal the page offers", async () => {
    await angemeldet();
    mail.answerWith(({ to }) => (to === NEU ? "refused" : "accepted"));

    const answer = await starteAdresswechselAction({ email: NEU });

    assert.match(answer.success ? (answer.message ?? "") : "", /Zieh die Änderung zurück und gib die Adresse erneut ein/);
  });

  /* An address change outlives the session making it, as a passkey does: past the enrolment window the page asks first. */
  it("asks for a confirmation first from a sign-in older than the enrolment window, sending and mailing nothing", async () => {
    const row = await angemeldet();
    row.createdAt = new Date(Date.now() - 10 * 60 * 1000);

    assert.deepEqual(await starteAdresswechselAction({ email: NEU }), stepUpRequired());
    assert.deepEqual(writes, []);
    assert.deepEqual(mail.sent, []);
  });

  /* The page asks for the passkey, its figures read again so its next press asks first (`docs/frontend/spec.md :: I493`). */
  it("answers the backend's confirmation refusal as the page's prompt, its figures read again, mailing nothing", async () => {
    await angemeldet();
    startAnswer = unbestaetigt;

    assert.deepEqual(await starteAdresswechselAction({ email: NEU }), stepUpRequired());
    assert.equal(writes.length, 1, "the backend was never asked, so the refusal proves nothing");
    assert.ok(
      cacheCalls.some(({ name }) => name === "refresh"),
      "the page's figures were not read again",
    );
    assert.deepEqual(mail.sent, []);
  });

  it("puts the address already signed in with on the box", async () => {
    await angemeldet();
    startAnswer = () => Response.json({ error_code: "REQ-ADRESSWECHSEL-007", trace_id: "0".repeat(32) }, { status: 409 });

    const answer = await starteAdresswechselAction({ email: BISHER });

    assert.equal(answer.success ? undefined : answer.fieldErrors?.email, "Mit dieser Adresse bist Du schon angemeldet.");
    assert.deepEqual(mail.sent, []);
  });
});

describe("the approval and the stop on the account page", () => {
  /* The notice with its stop link went out at the start: the approval mails the new address alone. */
  it("approves under the person's actor and mails the link to the new address alone", async () => {
    await angemeldet();

    const answer = await gibAdresswechselFreiAction({ id: CARRIER });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(writes, [{ method: "POST", path: FREIGABE, body: { id: CARRIER }, actor: true }]);
    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      [NEU],
    );
  });

  it("asks for a confirmation first before an approval from an old sign-in", async () => {
    const row = await angemeldet();
    row.createdAt = new Date(Date.now() - 10 * 60 * 1000);

    assert.deepEqual(await gibAdresswechselFreiAction({ id: CARRIER }), stepUpRequired());
    assert.deepEqual(writes, []);
  });

  it("answers the backend's confirmation refusal of an approval as the page's prompt, its figures read again", async () => {
    await angemeldet();
    freigabeAnswer = unbestaetigt;

    assert.deepEqual(await gibAdresswechselFreiAction({ id: CARRIER }), stepUpRequired());
    assert.equal(writes.length, 1, "the backend was never asked, so the refusal proves nothing");
    assert.ok(
      cacheCalls.some(({ name }) => name === "refresh"),
      "the page's figures were not read again",
    );
    assert.deepEqual(mail.sent, []);
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

/* `fl_frontend/src/app/refusalCoverage.test.ts` holds each mapper to every code; this holds each action to its mapper:
   every refusal the document publishes, at its own status and another, answered in the words that mapper gives. */
describe("each published refusal of the account page's address writes", () => {
  /** The sweep's refusal as the fetch double answers it, settled before the act reads it: the API client raises it again from the body. */
  function refusing(answerWith: (answer: () => Response) => void): {
    refuseWith: (next: () => Promise<unknown>) => void;
    settled: () => Promise<void>;
  } {
    let pending: Promise<void> = Promise.resolve();
    return {
      refuseWith: (next) => {
        pending = next().then(
          () => assert.fail("the refusal the assertion handed in answered"),
          (refusal: { serverErrorCode?: string; statusCode: number }) => {
            answerWith(() => Response.json({ error_code: refusal.serverErrorCode, trace_id: "0".repeat(32) }, { status: refusal.statusCode }));
          },
        );
      },
      settled: () => pending,
    };
  }

  it("answers each refusal of the start through the start's mapper", async () => {
    await angemeldet();
    const { refuseWith, settled } = refusing((answer) => (startAnswer = answer));

    await assertEachAnswered({
      operation: "POST /konto/adresswechsel",
      refuseWith: refuseWith,
      act: async () => {
        await settled();
        return starteAdresswechselAction({ email: NEU });
      },
      mapped: mapKontoAdresswechselRefusal,
    });
  });

  it("answers each refusal of the approval through the approval's mapper", async () => {
    await angemeldet();
    const { refuseWith, settled } = refusing((answer) => (freigabeAnswer = answer));

    await assertEachAnswered({
      operation: "POST /konto/adresswechsel/freigabe",
      refuseWith: refuseWith,
      act: async () => {
        await settled();
        return gibAdresswechselFreiAction({ id: CARRIER });
      },
      mapped: mapKontoFreigabeRefusal,
    });
  });

  /* A 404 is no rule's refusal, so the sweep above never asks it: the change gone since the page loaded, said by the
     press's own mapper rather than the shared reader's generic missing record. */
  for (const { operation, answerWith, act, mapper } of [
    {
      operation: "POST /konto/adresswechsel/freigabe",
      answerWith: (answer: () => Response) => (freigabeAnswer = answer),
      act: () => gibAdresswechselFreiAction({ id: CARRIER }),
      mapper: mapKontoFreigabeRefusal,
    },
    {
      operation: "DELETE /konto/adresswechsel",
      answerWith: (answer: () => Response) => (stoppAnswer = answer),
      act: () => stoppeAdresswechselAction(),
      mapper: mapKontoStoppRefusal,
    },
  ]) {
    it(`answers a change gone since the page loaded through its own mapper on ${operation}`, async () => {
      await angemeldet();
      const refusal = refusedOn(operation, "DB-COMMON-001");
      answerWith(() => Response.json({ error_code: refusal.serverErrorCode, trace_id: "0".repeat(32) }, { status: refusal.statusCode }));
      const own = mapper(refusal);

      assert.notEqual(own, null, `${operation}'s mapper leaves its 404 to the shared reader`);
      assert.deepEqual(await act(), { success: false, error: own });
    });
  }
});
