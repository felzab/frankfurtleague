import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

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

let antwortet: () => unknown;
let stoppt: () => unknown;
let liest: () => unknown;

const calls = doubleApiClient(({ endpoint }, schema) => {
  const antwort = endpoint === STOPP ? stoppt() : endpoint === ANSICHT ? liest() : antwortet();
  if (antwort instanceof Error) throw antwort;
  return schema.parse(antwort);
});
const mail = doubleSendMail();

doublePublicRouteRequest({ modules: { "core/logging.ts": LOGGING, "core/config.ts": CONFIG } });

const { POST } = await import("./route.ts");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");

const BISHER = "lena@alt.example";
const NEU = "lena@neu.example";
const TOKEN = "abc123";

const ANSWER_OPERATION = "POST /adresswechsel/bestaetigung";

/**
 * A confirmation that took effect, the change made because the mailbox is lost: no account moves on that way, so the
 * notice is this handler's one effect (the move is held in `features/adresswechsel/notifications.test.ts`).
 */
const WIRKSAM = {
  acknowledged: 1,
  antwort: "bestaetigt",
  wirksam_ab: null,
  genehmigung_offen: false,
  mitteilung: { bisherige_email: BISHER, email: NEU, vorname: "Lena", weg: "wartezeit" },
};

function aRequest(body: unknown) {
  return { headers: new Headers(), json: async () => body } as unknown as Parameters<typeof POST>[0];
}

const bodyOf = async (body: unknown): Promise<Record<string, unknown>> =>
  ((await POST(aRequest(body))) as unknown as { body: Record<string, unknown> }).body;

const sentTo = () => calls.map(({ endpoint, body: sent }) => [endpoint, JSON.parse(String(sent)) as unknown]);

beforeEach(() => {
  calls.length = 0;
  mail.sent.length = 0;
  mail.answerWith(() => "accepted");
  antwortet = () => WIRKSAM;
  stoppt = () => ({ acknowledged: 1, gestoppt: true });
  liest = () => ({ acknowledged: 1, ansicht: { seite: "neu", zustand: "beendet", art: "abgelehnt" } });
});

describe("the address page's handler", () => {
  /* The public answer's one widening: the replaced address reaches this handler alone, which mails the notice. */
  it("mails the replaced address its completion notice, and answers the browser without either address or the name", async () => {
    const body = await bodyOf({ token: TOKEN, antwort: "bestaetigt" });

    assert.deepEqual(body, { success: true, antwort: "bestaetigt", wirksam: true, wirksam_ab: null, genehmigung_offen: false });
    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      [BISHER],
    );
    assert.doesNotMatch(JSON.stringify(body), /alt\.example|neu\.example|Lena/, "the browser's answer carries what only the handler may read");
  });

  /* Best effort, as the notice at the start is: the change stands whatever the provider answered. */
  it("answers the effect as done where the completion notice did not leave", async () => {
    mail.answerWith(() => "refused");

    assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "bestaetigt" }), {
      success: true,
      antwort: "bestaetigt",
      wirksam: true,
      wirksam_ab: null,
      genehmigung_offen: false,
    });
  });

  for (const [stand, antwort, expected] of [
    [
      "started a waiting time, naming its end",
      { acknowledged: 1, antwort: "bestaetigt", wirksam_ab: "2026-10-28T12:30:00Z", genehmigung_offen: false, mitteilung: null },
      { wirksam: false, wirksam_ab: "2026-10-28T12:30:00Z", genehmigung_offen: false },
    ],
    [
      "waits for the Verwaltung's approval",
      { acknowledged: 1, antwort: "bestaetigt", wirksam_ab: null, genehmigung_offen: true, mitteilung: null },
      { wirksam: false, wirksam_ab: null, genehmigung_offen: true },
    ],
  ] as const) {
    it(`mails nobody where the confirmation ${stand}`, async () => {
      antwortet = () => antwort;

      assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "bestaetigt" }), { success: true, antwort: "bestaetigt", ...expected });
      assert.deepEqual(mail.sent, []);
    });
  }

  it("sends the stop through its own endpoint with the token alone, and mails nobody", async () => {
    const body = await bodyOf({ token: TOKEN, antwort: "gestoppt" });

    assert.deepEqual(body, { success: true, antwort: "gestoppt", wirksam: false, wirksam_ab: null, genehmigung_offen: false });
    assert.deepEqual(sentTo(), [[STOPP, { token: TOKEN }]]);
    assert.deepEqual(mail.sent, []);
  });

  it("answers a stop link nothing matches with the void link's panel", async () => {
    stoppt = () => refusedOn("POST /adresswechsel/bestaetigung/stopp", "REQ-ADRESSWECHSEL-001");

    assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "gestoppt" }), { success: false, zustand: "ungueltig" });
  });

  it("sends the new mailbox's answer to its endpoint, never to the stop's", async () => {
    antwortet = () => ({ acknowledged: 1, antwort: "abgelehnt", wirksam_ab: null, genehmigung_offen: false, mitteilung: null });

    await bodyOf({ token: TOKEN, antwort: "abgelehnt" });

    assert.deepEqual(sentTo(), [[ANTWORT, { token: TOKEN, antwort: "abgelehnt" }]]);
  });

  /* The change ended or this link was answered since the page opened: the page says how, never that the link is void. */
  it("reads the link again where the change ended since the page opened, and answers with what it now shows", async () => {
    antwortet = () => refusedOn(ANSWER_OPERATION, "REQ-ADRESSWECHSEL-002");

    const body = await bodyOf({ token: TOKEN, antwort: "bestaetigt" });

    assert.deepEqual(body, { success: false, ansicht: { zustand: "beendet", seite: "neu", art: "abgelehnt" } });
    assert.deepEqual(sentTo(), [
      [ANTWORT, { token: TOKEN, antwort: "bestaetigt" }],
      [ANSICHT, { token: TOKEN }],
    ]);
  });

  it("answers the ended change's press with no state where the read after it failed too", async () => {
    antwortet = () => refusedOn(ANSWER_OPERATION, "REQ-ADRESSWECHSEL-002");
    liest = () => new Error("network");

    assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "bestaetigt" }), { success: false, ansicht: null });
  });
});
