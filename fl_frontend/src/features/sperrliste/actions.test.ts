import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { act, createElement as h } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleSendMail } from "@/core/mailDouble.ts";
import { doubleActionRequest, doubleToasts, loggedLines } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import { mapAdresseRefusal } from "./refusals.ts";
import { FLPostSperrlistePayloadSchema } from "./schemas.ts";

import type { MailOutcome } from "@/core/mailDouble.ts";
import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The ORDER between the write and the send decides whether somebody is told they are barred by a
   request that then failed, and no render shows it (`docs/frontend/spec.md` §1.9). Each double
   appends to one list, read instead of the source. */
const events: string[] = [];

/* `refresh()` throws outside a request Next itself is rendering, and what a case here asks of it is
   that the action reached it at all. */
const CACHE_DOUBLE = { refresh: () => void events.push("refresh") };
const CONFIG_DOUBLE = { frontend_config: { AUTH_URL: "http://localhost:3000", LOG_LEVEL: "ERROR", LOG_FORMAT: "json" } };

/* The real actions, their mutations and the mailer's callers, called: the request they run in, the
   backend client and the mailer are the doubles. */
const request = doubleActionRequest();

// Registered after the request's doubles, so its `next/cache` answers before theirs.
registerDoubles({ modules: { "core/config.ts": CONFIG_DOUBLE }, specifiers: { "next/cache": CACHE_DOUBLE } });

/** The bound the WRITE answers. Deliberately not the five-season arithmetic's, so a mail stating it could have come from nowhere else. */
const ANSWERED_BOUND = "2044";
const SPERRE_ID = "6890a1b2c3d4e5f607190001";

/** The create's answer as the backend sends it, acknowledged or not. */
const banned = (acknowledged: 0 | 1) => ({ acknowledged, created_id: SPERRE_ID, gesperrt_bis_saison_id: ANSWERED_BOUND });

/** The read of what the barred address still holds, which a ban runs once it stands. */
const ANSICHT_ENDPOINT = "/identitaet/erasure/ansicht";

/** One referee record, the envelope and the grant's field around it, as the reveal answers them. */
const ANSICHT = {
  acknowledged: 1,
  spieler: [],
  schiedsrichter: [{ schiedsrichter_id: "6890a1b2c3d4e5f607190002", name: "Zorbanax Quell" }],
  sitze: [],
  bewerbungen: [],
  registrierungen: [],
  adresswechsel: [],
  spieler_adresswechsel: [],
  verwaltung: null,
};

let answerAnsicht: () => Promise<unknown> = () => Promise.resolve(ANSICHT);
beforeEach(() => {
  answerAnsicht = () => Promise.resolve(ANSICHT);
});

const eventOf = ({ endpoint, method }: ApiCall): string =>
  endpoint === ANSICHT_ENDPOINT ? "ansicht" : method === "DELETE" ? "delete" : "post";

const client = doubleApiAnswers((call) => {
  events.push(eventOf(call));
  if (call.endpoint === ANSICHT_ENDPOINT) return answerAnsicht();
  return Promise.resolve(call.method === "DELETE" ? { acknowledged: 1, sperrliste_id: SPERRE_ID } : banned(1));
});
/** Answers each write with `next`, the event list recording which write it was first; the read answers as `answerAnsicht` says. */
const answerWith = (next: () => Promise<unknown>): void =>
  client.answerWith((call: ApiCall) => {
    events.push(eventOf(call));
    return call.endpoint === ANSICHT_ENDPOINT ? answerAnsicht() : next();
  });

const mail = doubleSendMail();
/** Ends the notice with `outcome`, the event list recording the send first. */
const sendWith = (outcome: MailOutcome): void =>
  mail.answerWith(() => {
    events.push("mail");
    return outcome;
  });

beforeEach(() => {
  events.length = 0;
  sendWith("accepted");
});

/* The real module hands its raising to HeroUI's queue rather than back to the case that caused it. */
const { raised: toasts } = doubleToasts();

/* Reached with `await import` and never a static import beside the harness, which registers the JSX
   compile step as it evaluates (`docs/frontend/spec.md` §1.9). */
const { AdminCreateSperreForm } = await import("./components/forms/AdminCreateSperreForm.tsx");

const CREATE_OPERATION = "POST /sperrliste";

const { deleteSperreAction, postSperreAction } = await import("./actions.ts");
const { SPERRE_ERFOLG } = await import("./constants.ts");
const { ZURUECKGEHALTEN } = await import("@/features/einladungen/meldungen.ts");
const { boundCall, REQUEST_DEADLINE_MS } = await import("@/core/requestScope");

const BARRED = "zorbanax@beispielschule.de";
const GRUND = "Falsches Geburtsdatum angegeben";

const anAddressIsBanned = () => postSperreAction({ email: BARRED, grund: GRUND });

describe("the create's refusals", () => {
  /* The create is the one write that sends an address, so it is the one that answers through the
     mapper; what the mapper answers is asked of it in `fl_frontend/src/features/sperrliste/refusals.test.ts`. */
  it("answers every refusal the create publishes through the mapper, and tells nobody", async () => {
    await assertEachAnswered({
      operation: CREATE_OPERATION,
      refuseWith: answerWith,
      act: anAddressIsBanned,
      mapped: mapAdresseRefusal,
    });
    assert.deepEqual(mail.sent, [], "a refused ban mailed the address it refused");
  });
});

describe("the message the barred person is sent", () => {
  it("sends the notice only after the write has been acknowledged", async () => {
    const result = await anAddressIsBanned();

    assert.equal(result.success, true);
    assert.deepEqual(events, ["post", "mail", "ansicht", "refresh"]);
  });

  /* The half the order alone cannot show: a send placed after the call but before its answer is
     read would tell somebody they are barred by a write that did not take. */
  it("tells nobody where the write was not acknowledged", async () => {
    answerWith(() => Promise.resolve(banned(0)));

    const result = await anAddressIsBanned();

    assert.equal(result.success, false);
    assert.deepEqual(events, ["post"]);
  });

  /* The typed address is used for this one send and stored nowhere, so it reaches the mail module
     from the parsed payload and from no read of the row the write created. */
  it("mails the address that was typed, and the bound the write itself answered", async () => {
    await anAddressIsBanned();

    assert.equal(mail.sent.length, 1);
    assert.equal(mail.sent[0]?.to, BARRED);
    assert.deepEqual(
      requestsOf(client.calls).map(({ endpoint, body }) => [endpoint, body]),
      [
        ["/sperrliste", { email: BARRED, grund: GRUND }],
        [ANSICHT_ENDPOINT, { email: BARRED }],
      ],
    );
    // The write's own answer and not the arithmetic's: `ANSWERED_BOUND` is a season no reference
    // season in this file composes, so a second read could not have produced it.
    assert.match(String(mail.sent[0]?.text), new RegExp(`bis einschließlich der Saison ${ANSWERED_BOUND}`));
    assert.match(String(mail.sent[0]?.text), new RegExp(GRUND));
  });

  /* Through the notice's own sender, the one past the ban list, which holds the address it has just
     barred: through `sendMail` the notice would be kept from its own reader (`docs/frontend/spec.md :: I541`). */
  it("hands the notice to its own sender, the one the ban list lets through", async () => {
    await anAddressIsBanned();

    assert.equal(mail.notices.length, 1);
    assert.equal(mail.notices[0], mail.sent[0]);
  });

  /* The ban is already written and no address survives to re-send to, so a failure is reported
     rather than repaired -- and an administrator told nothing would assume the person knows. */
  it("leaves the ban standing on a failed send and says the person was not told", async () => {
    sendWith("refused");

    const result = await anAddressIsBanned();

    assert.equal(result.success, true);
    // The list is still refreshed and nothing is removed: the row stands, and only the sentence
    // the administrator reads differs.
    assert.deepEqual(events, ["post", "mail", "ansicht", "refresh"]);
    assert.notEqual("message" in result ? result.message : undefined, SPERRE_ERFOLG);
    assert.match(String("message" in result ? result.message : ""), /nicht zugestellt/);
  });

  /* Outside production every send is withheld, and a ban reporting that as a failed notice shows a
     failure on every local ban of an address an account holds. */
  it("answers a notice this deployment withheld in the deployment's words rather than as a failure", async () => {
    sendWith("withheld");

    const result = await anAddressIsBanned();

    assert.equal(result.success, true);
    assert.equal("message" in result ? result.message : undefined, `Die Sperre steht. ${ZURUECKGEHALTEN}`);
  });

  /* A connection broken after the send left may be a message the provider accepted: saying the person
     was not told would be a guess, as it would in a fan-out. */
  it("answers a notice whose connection broke off as a saved ban with an unclear notice", async () => {
    sendWith("lost");

    const result = await anAddressIsBanned();

    // The ban was acknowledged: the general unclear-save sentence sends the administrator to check a row that stands.
    assert.equal(result.success, true, "the acknowledged ban answered as unsaved or of unknown outcome");
    assert.equal("message" in result ? result.message : undefined, "Die Sperre steht. Ob die Benachrichtigung angekommen ist, ist unklar.");
    assert.deepEqual(events, ["post", "mail", "ansicht", "refresh"], "the ban's page was left standing");
  });

  /* The ban is written before its notice, so the request's deadline cutting the notice leaves only the notice in
     doubt, whatever the spine answers of a cut elsewhere (`docs/frontend/spec.md :: I372`). */
  it("answers a notice the request's deadline cut as a saved ban with an unclear notice", async (t) => {
    // The request's clock, which its deadline was set on as the press began.
    let clock = 0;
    t.mock.method(performance, "now", () => clock);
    mail.answerWith(async (): Promise<MailOutcome> => {
      events.push("mail");
      // The send bounded as the mailer bounds it, with a millisecond of the deadline left: the deadline cuts it.
      clock = REQUEST_DEADLINE_MS - 1;
      const bound = boundCall(REQUEST_DEADLINE_MS);
      await new Promise((resolve) => bound.signal.addEventListener("abort", resolve, { once: true }));
      bound.clear();
      return "lost";
    });

    const result = await anAddressIsBanned();

    assert.equal(result.success, true, `the acknowledged ban answered ${JSON.stringify(result)}`);
    assert.equal("message" in result ? result.message : undefined, "Die Sperre steht. Ob die Benachrichtigung angekommen ist, ist unklar.");
    assert.deepEqual(events, ["post", "mail", "ansicht", "refresh"], "the ban's page was left standing");
  });

  /* `EntityForm` shows the action's message as a description only where it DIFFERS from the title
     the form passes, so the success sentence and that literal are one string or every clean save
     grows a second line saying the same thing. */
  it("answers a clean save the exact title the form raises", async () => {
    const result = await anAddressIsBanned();

    assert.equal("message" in result ? result.message : undefined, SPERRE_ERFOLG);

    // The form over this same action, pressed as an administrator presses it.
    toasts.length = 0;
    const user = userEvent.setup();
    const { unmount } = render(underNext(h(AdminCreateSperreForm, { onClose: () => undefined })));
    await user.type(screen.getByRole("textbox", { name: /E-Mail/ }), BARRED);
    await user.type(screen.getByRole("textbox", { name: /Grund/ }), GRUND);
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    // The write runs inside a transition, so the press returns before its toast is raised.
    await act(client.answered);
    await waitFor(() => {
      assert.ok(toasts.length > 0, "the save raised no toast at all");
    });
    unmount();

    assert.deepEqual(
      toasts.map(({ variant, title, description }) => [variant, title, description]),
      [["success", SPERRE_ERFOLG, undefined]],
      "the form raises a title the action never answers, so a clean save shows it twice",
    );
  });
});

describe("the barred address's live sign-ins", () => {
  /* The refusal of every next sign-in reaches no session already open, so the ban ends those itself,
     and before the notice that says so. */
  it("signs the address that was typed out after the write is acknowledged, and before it is told", async () => {
    let signedOutWhenMailed: readonly string[] = [];
    mail.answerWith(() => {
      events.push("mail");
      signedOutWhenMailed = request.signedOut();
      return "accepted";
    });

    const result = await anAddressIsBanned();

    assert.equal("message" in result ? result.message : undefined, SPERRE_ERFOLG);
    assert.deepEqual(request.signedOut(), [BARRED]);
    assert.deepEqual(signedOutWhenMailed, [BARRED], "the notice left before the sign-out it reports");
  });

  it("signs nobody out where the write was refused or not acknowledged", async () => {
    answerWith(() => Promise.resolve(banned(0)));
    await anAddressIsBanned();

    answerWith(() => Promise.reject(refusedOn(CREATE_OPERATION, "REQ-SPERRLISTE-001", 409)));
    await anAddressIsBanned().catch(() => undefined);

    assert.deepEqual(request.signedOut(), []);
  });

  /* The ban is written and the address survives nowhere to retry with, so a failure is reported; a store
     that did not answer did not say whether an account holds the address either, so nobody is mailed. */
  it("leaves the ban standing, mails nobody and says both where the sessions could not be ended", async () => {
    request.failSignOut(new Error("the store answered nothing"));

    const result = await anAddressIsBanned();

    assert.equal(result.success, true);
    assert.equal(
      "message" in result ? result.message : undefined,
      "Die Sperre steht. Laufende Anmeldungen der Adresse konnten nicht beendet werden. Die Benachrichtigung an die Adresse konnte nicht zugestellt werden.",
    );
    assert.deepEqual(events, ["post", "ansicht", "refresh"], "a failed sign-out stopped the refresh, or a notice went on a guess");
  });
});

describe("which barred addresses the notice goes to (`docs/frontend/spec.md :: I517`)", () => {
  it("mails nothing to an address no account holds, and tells its administrator so", async () => {
    request.holdNoAccount();

    const result = await anAddressIsBanned();

    assert.equal(result.success, true);
    assert.equal(
      "message" in result ? result.message : undefined,
      "Die Sperre steht. Die Adresse hat kein Konto, deshalb wurde sie nicht benachrichtigt.",
    );
    assert.deepEqual(mail.sent, [], "an address holding no account was mailed");
    assert.deepEqual(events, ["post", "ansicht", "refresh"]);
    assert.deepEqual(request.signedOut(), [BARRED], "the store was not asked, so the case proves nothing");
  });

  // The control: the same ban on an address an account holds.
  it("mails an address an account holds", async () => {
    const result = await anAddressIsBanned();

    assert.equal("message" in result ? result.message : undefined, SPERRE_ERFOLG);
    assert.deepEqual(
      mail.sent.map(({ to }) => to),
      [BARRED],
    );
  });
});

describe("what the barred address still holds (`docs/frontend/spec.md :: I688`)", () => {
  /* Only this press holds the address, so the read goes in a read's body, after everything the ban owes the
     person, and its answer reaches the dialog without the envelope, the grant's field or anything of the address. */
  it("reads it in a body once the ban, its sign-out and its notice stand, and answers the records alone", async () => {
    let signedOutWhenRead: readonly string[] = [];
    answerAnsicht = () => {
      signedOutWhenRead = request.signedOut();
      // An address the reveal never serves, so a looser parse or a spread of the raw answer would hand it on.
      return Promise.resolve({ ...ANSICHT, email: BARRED });
    };

    const result = await anAddressIsBanned();

    assert.deepEqual(events, ["post", "mail", "ansicht", "refresh"], "the read ran before the notice, or not at all");
    assert.deepEqual(signedOutWhenRead, [BARRED], "the read ran before the sign-out");
    assert.deepEqual(requestsOf(client.calls).at(-1), { endpoint: ANSICHT_ENDPOINT, method: "POST", body: { email: BARRED }, readOnly: true });
    const { acknowledged: _umschlag, verwaltung: _zugang, ...records } = ANSICHT;
    assert.deepEqual("ansicht" in result ? result.ansicht : undefined, records);
    assert.doesNotMatch(JSON.stringify(result), new RegExp(BARRED), "the address reached the answer the browser is handed");
  });

  /* The ban was written and the address survives nowhere to read again with, so the failure is said in the
     dialog and nothing of the ban is taken back. The line names the failure and never the address. */
  it("leaves the ban standing and answers no records where the read failed, logging no address", async () => {
    answerAnsicht = () => Promise.reject(new Error(`no answer for ${BARRED}`));

    const result = await anAddressIsBanned();

    assert.equal(result.success, true, "a failed read answered the ban as unsaved");
    assert.equal("ansicht" in result ? result.ansicht : undefined, null);
    assert.equal("message" in result ? result.message : undefined, SPERRE_ERFOLG);
    assert.deepEqual(events, ["post", "mail", "ansicht", "refresh"], "the ban's page was left standing");
    assert.ok(
      loggedLines.some(({ message }) => message === "sperrliste.ansicht_not_read"),
      "the failed read was logged nowhere",
    );
    assert.doesNotMatch(JSON.stringify(loggedLines), new RegExp(BARRED), "the address reached the log stream");
  });

  /* The notice may spend the request's deadline, which then cuts this read: answered as the spine answers a cut
     write, the press would send the administrator to check a ban that stands (`docs/frontend/spec.md :: I372`). */
  it("answers a read the request's deadline cut as a saved ban with no records", async (t) => {
    let clock = 0;
    t.mock.method(performance, "now", () => clock);
    answerAnsicht = async () => {
      // The read bounded as the client bounds it, with a millisecond of the deadline left: the deadline cuts it.
      clock = REQUEST_DEADLINE_MS - 1;
      const bound = boundCall(REQUEST_DEADLINE_MS);
      await new Promise((resolve) => bound.signal.addEventListener("abort", resolve, { once: true }));
      bound.clear();
      throw bound.signal.reason;
    };

    const result = await anAddressIsBanned();

    assert.equal(result.success, true, `the acknowledged ban answered ${JSON.stringify(result)}`);
    assert.equal("ansicht" in result ? result.ansicht : undefined, null);
    assert.equal("message" in result ? result.message : undefined, SPERRE_ERFOLG);
  });
});

describe("the ban list's removal", () => {
  /* A removal whose row another administrator has already lifted answers 404, which
     `fl_frontend/src/shared/utils/actionError.ts` already words as the reload it is. */
  it("answers a row already lifted in the shared reader's words", async () => {
    const lifted = refusedOn("DELETE /sperrliste/{sperrliste_id}", "DB-COMMON-001", 404);
    answerWith(() => Promise.reject(lifted));

    const result = await deleteSperreAction({ id: SPERRE_ID });

    assert.deepEqual(result, toActionErrorResult(lifted, { method: "POST", readOnly: false }));
  });
});

/** What the box hands the action, judged by the same parse `postSperreAction` runs it through. */
const grundRefusal = (grund: string): string | undefined => {
  const parsed = FLPostSperrlistePayloadSchema.safeParse({ email: "vorstand@example.org", grund: grund });

  return parsed.success ? undefined : parsed.error.issues.find((issue) => issue.path[0] === "grund")?.message;
};

describe("the address a reason may not carry", () => {
  /* `grund` is served, copied whole into a removal's action-log image, and outlives the person's
     erasure, so an address typed there survives everywhere the stored hash keeps one out. */
  it("refuses an address standing alone and one buried in a sentence", () => {
    assert.equal(grundRefusal("zorbanax@beispielschule.de"), "Der Grund darf keine E-Mail-Adresse enthalten.");
    assert.equal(grundRefusal("Falsche Angabe, siehe zorbanax@beispielschule.de"), "Der Grund darf keine E-Mail-Adresse enthalten.");
  });

  /* A bare `@` is ordinary German prose, and refusing it would turn away the common reason to catch
     the rare one. Both ends take these, so a tightened mirror marks a box the API would not. */
  it("takes a reason whose only `@` is a word", () => {
    assert.equal(grundRefusal("Nach Absprache @ Schulleitung"), undefined);
    assert.equal(grundRefusal("Siehe Mail vom 3.4."), undefined);
  });
});
