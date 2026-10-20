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

const ANTWORT = "/schiedsrichter/adresswechsel";
const STOPP = "/schiedsrichter/adresswechsel/stopp";

let antwortet: () => unknown;
let stoppt: () => unknown;

const calls = doubleApiClient(({ endpoint }, schema) => {
  const antwort = endpoint === STOPP ? stoppt() : antwortet();
  if (antwort instanceof Error) throw antwort;
  return schema.parse(antwort);
});
const mail = doubleSendMail();

doublePublicRouteRequest({ modules: { "core/logging.ts": LOGGING, "core/config.ts": CONFIG } });

const { POST } = await import("./route.ts");
const { refusedOn } = await import("@/shared/testing/publishedRefusals.ts");

const BISHER = "anna@alt.example";
const TOKEN = "abc123";

/** The confirmation that took effect, answering the replaced address for its completion notice. */
const WIRKSAM = { acknowledged: 1, antwort: "bestaetigt", wirksam_ab: null, mitteilung: { bisherige_email: BISHER, vorname: "Anna" } };

function aRequest(body: unknown) {
  return { headers: new Headers(), json: async () => body } as unknown as Parameters<typeof POST>[0];
}

const bodyOf = async (body: unknown): Promise<Record<string, unknown>> =>
  ((await POST(aRequest(body))) as unknown as { body: Record<string, unknown> }).body;

beforeEach(() => {
  calls.length = 0;
  mail.sent.length = 0;
  mail.answerWith(() => "accepted");
  antwortet = () => WIRKSAM;
  stoppt = () => ({ acknowledged: 1, gestoppt: true });
});

describe("the referee's address page's handler", () => {
  /* The public answer's one widening: the replaced address reaches this handler alone, which mails the notice. */
  it("mails the replaced address its completion notice, and answers the browser without the address or the name", async () => {
    const body = await bodyOf({ token: TOKEN, antwort: "bestaetigt" });

    assert.deepEqual(body, { success: true, antwort: "bestaetigt", wirksam_ab: null });
    assert.deepEqual(
      mail.sent.map(({ to, subject }) => [to, subject]),
      [[BISHER, "Deine E-Mail-Adresse bei der Frankfurt League wurde geändert"]],
    );
    assert.doesNotMatch(JSON.stringify(body), /alt\.example|Anna/, "the browser's answer carries what only the handler may read");
  });

  /* Best effort, as the notice at the start is: the change stands whatever the provider answered. */
  it("answers the effect as done where the completion notice did not leave", async () => {
    mail.answerWith(() => "refused");

    assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "bestaetigt" }), { success: true, antwort: "bestaetigt", wirksam_ab: null });
  });

  it("mails nobody where the confirmation started a waiting time, and names its end", async () => {
    antwortet = () => ({ acknowledged: 1, antwort: "bestaetigt", wirksam_ab: "2026-10-28T12:30:00Z", mitteilung: null });

    const body = await bodyOf({ token: TOKEN, antwort: "bestaetigt" });

    assert.deepEqual(body, { success: true, antwort: "bestaetigt", wirksam_ab: "2026-10-28T12:30:00Z" });
    assert.deepEqual(mail.sent, []);
  });

  it("sends the stop through its own endpoint with the token alone, and mails nobody", async () => {
    const body = await bodyOf({ token: TOKEN, antwort: "gestoppt" });

    assert.deepEqual(body, { success: true, antwort: "gestoppt", wirksam_ab: null });
    assert.deepEqual(
      calls.map(({ endpoint, body: sent }) => [endpoint, JSON.parse(String(sent)) as unknown]),
      [[STOPP, { token: TOKEN }]],
    );
    assert.deepEqual(mail.sent, []);
  });

  it("answers a stop link nothing matches with the void link's panel", async () => {
    stoppt = () => refusedOn("POST /schiedsrichter/adresswechsel/stopp", "REQ-SCHIEDSRICHTER-002");

    assert.deepEqual(await bodyOf({ token: TOKEN, antwort: "gestoppt" }), { success: false, zustand: "ungueltig" });
  });

  it("sends the new mailbox's answer to its endpoint, never to the stop's", async () => {
    antwortet = () => ({ acknowledged: 1, antwort: "abgelehnt", wirksam_ab: null, mitteilung: null });

    await bodyOf({ token: TOKEN, antwort: "abgelehnt" });

    assert.deepEqual(
      calls.map(({ endpoint, body: sent }) => [endpoint, JSON.parse(String(sent)) as unknown]),
      [[ANTWORT, { token: TOKEN, antwort: "abgelehnt" }]],
    );
  });
});
