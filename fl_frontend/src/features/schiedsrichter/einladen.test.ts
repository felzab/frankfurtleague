import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { cacheCalls, doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { doubleSendMail } from "@/shared/testing/mailDouble.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real actions, their mutations and reads, and the link mailer, called: the request they run in,
   the backend client and the mailer are the doubles. */
doubleActionRequest();
const mail = doubleSendMail();
// The origin the link is minted on, which the real config reads from an environment this run has not got.
registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) {
      return { format: "module", source: `export const frontend_config = { AUTH_URL: "http://localhost:3000" };`, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

/** What each endpoint answers in this case, returned or, where it is an `Error`, thrown. */
type Answer = () => unknown;
let row: Answer;
let mint: Answer;
let create: Answer;
let save: Answer;
let reactivate: Answer;

/** The answer `call` gets: the delivery report each sent link files is applied, as the endpoint applies it. */
function answerFor({ endpoint, method }: ApiCall): unknown {
  if (endpoint.startsWith("/zustellung/")) return { acknowledged: 1, angewendet: true };
  if (method === undefined) return row();
  if (endpoint.endsWith("/einladen")) return mint();
  if (endpoint.endsWith("/reactivate")) return reactivate();
  return method === "PATCH" ? save() : create();
}

const client = doubleApiAnswers(async (call) => {
  const answer = answerFor(call);
  if (answer instanceof Error) throw answer;
  return answer;
});

const { einladeSchiedsrichterAction, patchSchiedsrichterAction, postSchiedsrichterAction, reactivateSchiedsrichterAction } =
  await import("./actions.ts");
const { describeLinkMail } = await import("./notifications.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");

const SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607800001";

const aRefusal = (serverErrorCode: string, statusCode = 409) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://localhost/schiedsrichter",
    statusCode,
    serverErrorCode,
    endpoint: "/schiedsrichter",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

/** The referee as the backend stores it, holding `email`. */
const stored = (email: string | null, name: string | null = "Anna Meier") => ({
  id: SCHIEDSRICHTER_ID,
  name,
  schule: null,
  default_payment: 20,
  kontakt: { email, telefon: null },
  inactive_since: null,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
});

const withRow = (email: string | null, name?: string | null) => () => ({ acknowledged: 1, schiedsrichter: stored(email, name) });

/** A link minted for `email`, as each minting write answers it. */
const minted = (email: string) => ({ token: "abc", frist: "2026-10-05", email });

/** Every re-send mint the case sent. */
const mints = () => requestsOf(client.calls).filter(({ endpoint }) => endpoint.endsWith("/einladen"));

/** The address of every message the mailer was handed. */
const mailedTo = () => mail.sent.map(({ to }) => to);

beforeEach(() => {
  row = withRow("anna@example.de");
  mint = () => ({ acknowledged: 1, bestaetigung: minted("anna@example.de") });
  create = () => ({ acknowledged: 1, created_id: SCHIEDSRICHTER_ID, bestaetigung: minted("anna@example.de") });
  // A DIFFERENT address from the one `ENTWURF` carries: the save writes the correction and the mint
  // reads it back, so a site mailing the payload instead would be visible here.
  save = () => ({
    acknowledged: 1,
    updated_document: stored("korrigiert@example.de"),
    fanned_out_to_spiele: 0,
    bestaetigung: minted("korrigiert@example.de"),
  });
  reactivate = () => ({ acknowledged: 1, updated_document: stored("anna@example.de"), bestaetigung: minted("anna@example.de") });
});

describe("the re-send the editor's panel presses", () => {
  it("mints once and mails the stored address", async () => {
    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, true);
    assert.deepEqual(mints(), [{ endpoint: `/schiedsrichter/${SCHIEDSRICHTER_ID}/bestaetigung/einladen`, method: "POST", body: undefined }]);
    assert.deepEqual(mailedTo(), ["anna@example.de"]);
  });

  /* The mint replaces the row's confirmation block, which the editor's panel shows, so the page is read again. */
  it("refreshes the editor's page after a re-send that minted", async () => {
    assert.equal(
      (await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID })).success,
      true,
      "the re-send never minted, so what it moves is judged on nothing",
    );

    assert.deepEqual(cacheCalls, [{ name: "refresh", args: [] }]);
  });

  /* The row is read before the mint, so a save landing between the two moved the mailbox this link
     was made for; the answer is the only reader that saw the write's own transaction. */
  it("mails the address the MINT names, not the one the earlier read returned", async () => {
    mint = () => ({
      acknowledged: 1,
      bestaetigung: { token: "abc", frist: "2026-10-05", email: "inzwischen@example.de" },
    });

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.deepEqual(mailedTo(), ["inzwischen@example.de"]);
    assert.match(res.success ? res.message : "", /inzwischen@example\.de/);
  });

  it("says the previous link is dead whichever way the send went", async () => {
    for (const delivered of [true, false]) {
      mail.answerWith(() => (delivered ? "accepted" : "refused"));
      const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

      assert.match(res.success ? res.message : "", /Der vorherige Link gilt nicht mehr\./);
    }
  });

  /* Judged before the mint: a round trip to be told what the panel can already see is one nobody
     owes, and a mint whose message cannot leave stamps a send day for a message that never went. */
  it("refuses a row with no address without minting anything", async () => {
    row = withRow(null);

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /keine verwendbare E-Mail-Adresse hinterlegt/);
    assert.deepEqual(mints(), []);
    assert.deepEqual(mail.sent, []);
  });

  it("refuses a row the read no longer finds", async () => {
    row = () => aRefusal("DB-COMMON-001", 404);

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /gibt es nicht mehr/);
    assert.deepEqual(mints(), []);
  });

  /* Every refusal the endpoint declares, worded at the panel rather than falling through to the
     shared sentence, which names no rule. */
  for (const [code, fragment] of [
    ["REQ-SCHIEDSRICHTER-001", /stillgelegt/],
    ["REQ-SCHIEDSRICHTER-004", /schon bestätigt/],
    ["REQ-SCHIEDSRICHTER-006", /keine verwendbare E-Mail-Adresse hinterlegt/],
    ["REQ-SCHIEDSRICHTER-007", /Sperrliste/],
  ] as const) {
    it(`words ${code} at the panel, and mails nothing`, async () => {
      mint = () => {
        throw aRefusal(code);
      };

      const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

      assert.equal(res.success, false);
      assert.match(res.success ? "" : res.error, fragment);
      assert.deepEqual(mail.sent, []);
    });
  }

  /* The one refusal here that no endpoint publishes, so `publishedRefusals` never reaches it and a verb
     drifting back would stand unseen beside the four sentences that say „senden“. */
  it("names the send in the league's own verb where the mint was not acknowledged", async () => {
    mint = () => ({ acknowledged: 0, bestaetigung: minted("anna@example.de") });

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /Der Bestätigungslink wurde nicht gesendet/);
    assert.deepEqual(mail.sent, []);
  });

  it("refuses a payload that is no identifier, without reaching the endpoint", async () => {
    const res = await einladeSchiedsrichterAction({ id: "nicht-hex" });

    assert.equal(res.success, false);
    assert.deepEqual(mints(), []);
  });
});

const ENTWURF = { name: "Anna Meier", default_payment: 20, schule: null, kontakt: { email: "anna@example.de", telefon: null } };

describe("what the create tells the administrator", () => {
  it("reports the message the mint sent rather than the title the toast already carries", async () => {
    const res = await postSchiedsrichterAction(ENTWURF);

    assert.equal(res.success && res.message, describeLinkMail("anna@example.de", true));
  });

  /* The cleared box submits `null`: refused on that box in German, before the endpoint is reached,
     because a referee entered without an address is a person never told of it. */
  it("refuses a create without an address on the address box, reaching no endpoint and mailing nothing", async () => {
    create = () => {
      throw new Error("the create reached the endpoint");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: null, telefon: null } });

    assert.equal(res.success, false);
    assert.equal(res.success ? undefined : res.fieldErrors?.["kontakt.email"], "Bitte gib eine E-Mail-Adresse ein.");
    assert.deepEqual(mail.sent, []);
  });

  /* A reserved domain passes the form's rule and only the API refuses it: its 422 names the box, and
     the create answers there rather than in a toast naming no field. */
  it("puts an address only the API refuses on the address box, mailing nothing", async () => {
    create = () => {
      throw refusedPayload([bodyField(["kontakt", "email"])], "/schiedsrichter");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: "anna@beispiel.test", telefon: null } });

    assert.equal(res.success, false);
    assert.deepEqual(res.success ? undefined : res.fieldErrors, { "kontakt.email": FELD_ABGELEHNT });
    assert.deepEqual(mail.sent, []);
  });
});

/* The placeholder a row without an address is given, which the API refuses with a 422 whose box gets
   only the generic sentence: refused here instead, the box says the placeholder is what has to change. */
describe("a save still carrying the placeholder address", () => {
  it("is refused on the address box in German, before the endpoint", async () => {
    save = () => {
      throw new Error("the save reached the endpoint");
    };

    const res = await patchSchiedsrichterAction({
      ...ENTWURF,
      id: SCHIEDSRICHTER_ID,
      kontakt: { email: "adresse-fehlt@frankfurtleague.invalid", telefon: null },
    });

    assert.equal(res.success, false);
    assert.equal(
      res.success ? undefined : res.fieldErrors?.["kontakt.email"],
      "Bitte gib statt des Platzhalters die echte E-Mail-Adresse ein.",
    );
    assert.deepEqual(mail.sent, []);
  });

  // Each payload declares its own `kontakt`, so a save redeclaring the address as optional passes
  // every create case and lets an edit clear the only route by which the person learns of the entry.
  it("is refused on the address box without an address as well, before the endpoint", async () => {
    save = () => {
      throw new Error("the save reached the endpoint");
    };

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID, kontakt: { email: null, telefon: null } });

    assert.equal(res.success, false);
    assert.equal(res.success ? undefined : res.fieldErrors?.["kontakt.email"], "Bitte gib eine E-Mail-Adresse ein.");
    assert.deepEqual(mail.sent, []);
  });
});

/* Driven here rather than at the editor, whose case answers a DOUBLE of this action: a save
   reporting nothing about the link it sent leaves the administrator with no record that a message
   went to a corrected address. */
describe("what the save hands the editor about the message it sent", () => {
  it("reports the send's own sentence beside the standard one", async () => {
    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.message, "Schiedsrichter bearbeitet");
    assert.equal(res.success && res.versandSatz, describeLinkMail("korrigiert@example.de", true));
    assert.equal(res.success && res.versandFehlgeschlagen, false);
  });

  it("marks a send that did not leave, so the editor can grade its toast", async () => {
    mail.answerWith(() => "refused");

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.versandSatz, describeLinkMail("korrigiert@example.de", false));
    assert.equal(res.success && res.versandFehlgeschlagen, true);
  });

  it("hands over no sentence where the save minted nothing", async () => {
    save = () => ({ acknowledged: 1, updated_document: stored("anna@example.de"), fanned_out_to_spiele: 0, bestaetigung: null });

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.versandSatz, undefined);
    assert.deepEqual(mail.sent, []);
  });
});

/* A retired referee's save stores a new address and mails nothing, so coming back is what asks an
   unanswered one: the link the reactivation minted is mailed here, or nobody ever sends it. */
describe("the reactivation of an unanswered referee", () => {
  it("mails the link the reactivation minted, to the address the mint read, and says so", async () => {
    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.message, describeLinkMail("anna@example.de", true));
    assert.deepEqual(
      mail.sent.map(({ to, tags }) => ({ to, zielId: tags?.ziel_id })),
      [{ to: "anna@example.de", zielId: SCHIEDSRICHTER_ID }],
    );
    assert.equal(res.success && res.versandFehlgeschlagen, false);
  });

  it("marks a link that did not leave, so the row can grade its toast", async () => {
    mail.answerWith(() => "refused");

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.message, describeLinkMail("anna@example.de", false));
    assert.equal(res.success && res.versandFehlgeschlagen, true);
  });

  it("mails nothing where the row came back unasked", async () => {
    reactivate = () => ({ acknowledged: 1, updated_document: stored("anna@example.de"), bestaetigung: null });

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.message, "Schiedsrichter reaktiviert");
    assert.deepEqual(mail.sent, []);
  });

  it("words the ban the mint on return is refused on", async () => {
    reactivate = () => {
      throw aRefusal("REQ-SCHIEDSRICHTER-007");
    };

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /Sperrliste/);
    assert.deepEqual(mail.sent, []);
  });
});

/* The re-send takes the placeholder for no address before any round trip, and leaves a real address
   to the API. */
describe("the re-send of a row holding the placeholder", () => {
  it("is refused as having no address, reaching no endpoint", async () => {
    row = withRow("adresse-fehlt@frankfurtleague.invalid");

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /keine verwendbare E-Mail-Adresse/);
    assert.deepEqual(mints(), []);
    assert.deepEqual(mail.sent, []);
  });
});
