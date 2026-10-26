import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, it } from "node:test";

import { overridingModule } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";
import { doublePublicRouteRequest } from "@/shared/testing/publicRoutes.ts";

/* Replaced at the module boundary: the real client reaches a backend no test process runs, and the
   real mailer a provider. */
const inert = (): undefined => undefined;
const LOGGING = { logger: { info: inert, warn: inert, error: inert } };
/** The serving origin, which the completion notice's close is built on. */
const ORIGIN = "http://localhost:3000";
const CONFIG = { frontend_config: { AUTH_URL: ORIGIN, APP_ENV: "test" } };

const ANSICHT = "/adresswechsel/bestaetigung/ansicht";
const ANTWORT = "/adresswechsel/bestaetigung";
const STOPP = "/adresswechsel/bestaetigung/stopp";
const CLAIM = "/adresswechsel/sweep/postausgang";
const STAMP = "/adresswechsel/sweep/postausgang/zugestellt";
/** The system tier's read of the link's new address, which the press asks the sign-in store about. */
const ADRESSE = "/adresswechsel/sweep/adresse";

let antwortet: () => unknown;
let stoppt: () => unknown;
let liest: () => unknown;
/** The new address the link's change would move to, folded, or null for a key naming no live change. */
let neueAdresse: string | null;
/** The folded addresses the sign-in store holds an account at. */
let konten: string[];
/** What the outbox holds for the next claim, emptied by it: the drain claims until a claim holds nothing. */
let owed: unknown[];

const claim = () => {
  const mitteilungen = owed;
  owed = [];
  return { acknowledged: 1, beanspruchung: mitteilungen.length > 0 ? "claim-1" : null, beansprucht_bis: null, mitteilungen: mitteilungen };
};

const ABGLEICH = "/berechtigungen/abgleich";
const NOTHING_ANNOUNCED = { acknowledged: 1, beanspruchung: null, beansprucht_bis: null, aenderungen: [], empfaenger: [], uebersprungen: 0 };

const calls = doubleApiClient(({ endpoint }, schema) => {
  const antwort =
    endpoint === ABGLEICH
      ? NOTHING_ANNOUNCED
      : endpoint === ADRESSE
        ? { acknowledged: 1, email: neueAdresse }
        : endpoint === STOPP
          ? stoppt()
          : endpoint === ANSICHT
            ? liest()
            : endpoint === CLAIM
              ? claim()
              : endpoint === STAMP
                ? { acknowledged: 1, zugestellt: 1, ignoriert: 0 }
                : antwortet();
  if (antwort instanceof Error) throw antwort;
  return schema.parse(antwort);
});
const mail = doubleSendMail();

/** Work the real `after` would run behind the response, collected so a case runs it once the answer is read. */
const deferred: (() => unknown)[] = [];

doublePublicRouteRequest({
  modules: {
    "core/logging.ts": LOGGING,
    "core/config.ts": CONFIG,
    // The real store, but for the one lookup the press makes: no database answers this process.
    "core/auth.ts": overridingModule(`${import.meta.resolve("@/core/auth.ts")}?real`, {
      accountStandsAt: () => async (address: string) => konten.includes(address),
    }),
  },
  specifiers: {
    "next/server": {
      NextResponse: { json: (body: unknown, init?: ResponseInit) => ({ body, status: init?.status ?? 200 }) },
      after: (task: () => unknown) => void deferred.push(AsyncLocalStorage.bind(task)),
    },
  },
});

const { POST } = await import("./route.ts");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");

const BISHER = "lena@alt.example";
const NEU = "lena@neu.example";
const TOKEN = "abc123";

const ANSWER_OPERATION = "POST /adresswechsel/bestaetigung";

/** A confirmation that took effect: its notice is in the outbox the effect wrote, never in this answer. */
const WIRKSAM = { acknowledged: 1, antwort: "bestaetigt", wirksam: true, wirksam_ab: null, genehmigung_offen: false };

/**
 * The notice that effect owes, the change made because the mailbox is lost: no account moves on that way, so the notice
 * is the drain's one effect here (the move is held in `features/adresswechsel/notifications.test.ts`).
 */
const OWED_ID = "68c1f0a2b3c4d5e6f7a8b9e1";
const OWED = {
  id: OWED_ID,
  art: "wirksam",
  bisherige_email: BISHER,
  email: NEU,
  vorname: null,
  weg: "wartezeit",
  aufgegeben: false,
};

const stamped = () => calls.filter(({ endpoint }) => endpoint === STAMP).map(({ body: sent }) => JSON.parse(String(sent)) as unknown);

function aRequest(body: unknown) {
  return { headers: new Headers(), json: async () => body } as unknown as Parameters<typeof POST>[0];
}

const bodyOf = async (body: unknown): Promise<Record<string, unknown>> =>
  ((await POST(aRequest(body))) as unknown as { body: Record<string, unknown> }).body;

const sentTo = () => calls.map(({ endpoint, body: sent }) => [endpoint, JSON.parse(String(sent)) as unknown]);

beforeEach(() => {
  calls.length = 0;
  deferred.length = 0;
  mail.sent.length = 0;
  mail.answerWith(() => "accepted");
  owed = [OWED];
  antwortet = () => WIRKSAM;
  stoppt = () => ({ acknowledged: 1, gestoppt: true });
  liest = () => ({ acknowledged: 1, ansicht: { seite: "neu", zustand: "beendet", art: "abgelehnt" } });
  neueAdresse = NEU;
  konten = [];
});

describe("the address page's handler", () => {
  /* The answer carries no address: the replaced one is read from the outbox behind the response, by this server alone. */
  it("answers the browser at once, then delivers the outbox's completion notice behind the response and stamps it", async () => {
    const body = await bodyOf({ token: TOKEN, antwort: "bestaetigt" });

    assert.deepEqual(body, { success: true, antwort: "bestaetigt", wirksam: true, wirksam_ab: null, genehmigung_offen: false });
    assert.deepEqual(mail.sent, [], "the answer waited on the notice");

    for (const task of deferred) await task();

    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      [BISHER],
    );
    assert.deepEqual(stamped(), [{ beanspruchung: "claim-1", ids: [OWED_ID] }]);
    // A grant the effect moved is announced behind the answer too, not at the next five-minute pass.
    assert.ok(
      calls.some(({ endpoint }) => endpoint === ABGLEICH),
      "the confirmation left a moved grant's announcement to the next pass",
    );
  });

  /* The change stands whatever the provider answered; the notice waits for the next claim once this one's lease lapses. */
  it("answers the effect as done where the completion notice did not leave, and leaves the notice unstamped", async () => {
    mail.answerWith(() => "unsent");

    assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "bestaetigt" }), {
      success: true,
      antwort: "bestaetigt",
      wirksam: true,
      wirksam_ab: null,
      genehmigung_offen: false,
    });
    for (const task of deferred) await task();

    assert.deepEqual(stamped(), []);
  });

  for (const [stand, antwort, expected] of [
    [
      "started a waiting time, naming its end",
      { acknowledged: 1, antwort: "bestaetigt", wirksam: false, wirksam_ab: "2026-10-28T12:30:00Z", genehmigung_offen: false },
      { wirksam: false, wirksam_ab: "2026-10-28T12:30:00Z", genehmigung_offen: false },
    ],
    [
      "waits for the Verwaltung's approval",
      { acknowledged: 1, antwort: "bestaetigt", wirksam: false, wirksam_ab: null, genehmigung_offen: true },
      { wirksam: false, wirksam_ab: null, genehmigung_offen: true },
    ],
  ] as const) {
    it(`drains nothing where the confirmation ${stand}`, async () => {
      antwortet = () => antwort;

      assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "bestaetigt" }), { success: true, antwort: "bestaetigt", ...expected });
      assert.deepEqual(deferred, []);
      assert.deepEqual(mail.sent, []);
    });
  }

  it("sends the stop through its own endpoint with the token alone, and drains nothing", async () => {
    const body = await bodyOf({ token: TOKEN, antwort: "gestoppt" });

    assert.deepEqual(body, { success: true, antwort: "gestoppt", wirksam: false, wirksam_ab: null, genehmigung_offen: false });
    assert.deepEqual(sentTo(), [[STOPP, { token: TOKEN }]]);
    assert.deepEqual(deferred, []);
    assert.deepEqual(mail.sent, []);
  });

  it("answers a stop link nothing matches with the void link's panel", async () => {
    stoppt = () => refusedOn("POST /adresswechsel/bestaetigung/stopp", "REQ-ADRESSWECHSEL-001");

    assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "gestoppt" }), { success: false, zustand: "ungueltig" });
  });

  it("sends the new mailbox's answer to its endpoint, never to the stop's", async () => {
    antwortet = () => ({ acknowledged: 1, antwort: "abgelehnt", wirksam: false, wirksam_ab: null, genehmigung_offen: false });

    await bodyOf({ token: TOKEN, antwort: "abgelehnt" });

    assert.deepEqual(sentTo(), [[ANTWORT, { token: TOKEN, antwort: "abgelehnt" }]]);
  });

  /* The change ended or this link was answered since the page opened: the page says how, never that the link is void. */
  it("reads the link again where the change ended since the page opened, and answers with what it now shows", async () => {
    antwortet = () => refusedOn(ANSWER_OPERATION, "REQ-ADRESSWECHSEL-002");

    const body = await bodyOf({ token: TOKEN, antwort: "bestaetigt" });

    assert.deepEqual(body, { success: false, ansicht: { zustand: "beendet", seite: "neu", art: "abgelehnt" } });
    assert.deepEqual(sentTo(), [
      [ADRESSE, { token: TOKEN }],
      [ANTWORT, { token: TOKEN, antwort: "bestaetigt" }],
      [ANSICHT, { token: TOKEN }],
    ]);
  });

  it("answers the ended change's press with no state where the read after it failed too", async () => {
    antwortet = () => refusedOn(ANSWER_OPERATION, "REQ-ADRESSWECHSEL-002");
    liest = () => new Error("network");

    assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "bestaetigt" }), { success: false, ansicht: null });
  });

  /* The sign-in store is this server's, so the backend's press cannot refuse an account at the new address: the handler
     does, before the press, in the panel the backend's own refusals of the address open, and moves nothing. */
  it("refuses a confirmation whose new address an account signs in at, sending no press and draining nothing", async () => {
    konten = [NEU];

    assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "bestaetigt" }), { success: false, zustand: "nicht_bestaetigbar" });
    assert.deepEqual(sentTo(), [[ADRESSE, { token: TOKEN }]]);
    assert.deepEqual(deferred, []);
  });

  /* A decline removes an address nobody proved, so nothing it could join is asked about. */
  it("sends a decline whatever the new address holds, asking the sign-in store nothing", async () => {
    konten = [NEU];
    antwortet = () => ({ acknowledged: 1, antwort: "abgelehnt", wirksam: false, wirksam_ab: null, genehmigung_offen: false });

    assert.equal((await bodyOf({ token: TOKEN, antwort: "abgelehnt" })).success, true);
    assert.deepEqual(sentTo(), [[ANTWORT, { token: TOKEN, antwort: "abgelehnt" }]]);
  });
});
