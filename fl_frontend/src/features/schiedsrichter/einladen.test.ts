import { cacheCalls, doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { doubleSendMail } from "@/test-support/mailDouble.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ApiCall } from "@/test-support/apiClientDouble.ts";

/* The real actions, their mutations and reads, and the link mailer, called: the request they run in,
   the backend client and the mailer are the doubles. */
doubleActionRequest();
const mail = doubleSendMail();
// The origin the link is minted on, which the real config reads from an environment this run has not got.
vi.doMock("@/core/config.ts", () => ({ frontend_config: { AUTH_URL: "http://localhost:3000" } }));

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
const { ZURUECKGEHALTEN } = await import("@/features/einladungen/meldungen.ts");
const { refusedOn } = await import("@/test-support/publishedRefusals.ts");
const { FELD_ABGELEHNT, outcomeUnknown } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/test-support/refusedPayload.ts");

const SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607800001";

const ROW_OPERATION = "GET /schiedsrichter/{schiedsrichter_id}";
const MINT_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/bestaetigung/einladen";
const REACTIVATE_OPERATION = "POST /schiedsrichter/{schiedsrichter_id}/reactivate";

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

const withRow = (email: string | null, name?: string | null) => () => ({
  acknowledged: 1,
  schiedsrichter: stored(email, name),
  bestaetigung_abgelaufen: false,
  adresswechsel_id: null,
  adresswechsel_einsehbar_verwehrt: null,
});

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

    expect(res.success).toBe(true);
    expect(mints()).toStrictEqual([
      { endpoint: `/schiedsrichter/${SCHIEDSRICHTER_ID}/bestaetigung/einladen`, method: "POST", body: undefined },
    ]);
    expect(mailedTo()).toStrictEqual(["anna@example.de"]);
  });

  /* The mint replaces the row's confirmation block, which the editor's panel shows, so the page is read again. */
  it("refreshes the editor's page after a re-send that minted", async () => {
    expect(
      (await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID })).success,
      "the re-send never minted, so what it moves is judged on nothing",
    ).toBe(true);

    expect(cacheCalls.filter(({ name }) => name === "refresh")).toStrictEqual([{ name: "refresh", args: [] }]);
  });

  /* The row is read before the mint, so a save landing between the two moved the mailbox this link
     was made for; the answer is the only reader that saw the write's own transaction. */
  it("mails the address the MINT names, not the one the earlier read returned", async () => {
    mint = () => ({
      acknowledged: 1,
      bestaetigung: { token: "abc", frist: "2026-10-05", email: "inzwischen@example.de" },
    });

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(mailedTo()).toStrictEqual(["inzwischen@example.de"]);
    expect(res.success ? res.message : "").toMatch(/inzwischen@example\.de/);
  });

  it("says the previous link is dead whichever way the send went", async () => {
    for (const delivered of [true, false]) {
      mail.answerWith(() => (delivered ? "accepted" : "refused"));
      const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

      expect(res.success ? res.message : "").toMatch(/Der vorherige Link gilt nicht mehr\./);
    }
  });

  /* As the save reports its own link: a barred send is filed rather than failed. */
  it("reports a re-sent link that did not leave as failed, and a barred one as barred", async () => {
    mail.answerWith(() => "refused");
    const refused = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });
    mail.answerWith(() => "barred");
    const barred = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(refused.success && refused.versand).toBe("fehlgeschlagen");
    expect(barred.success && barred.versand).toBe("gesperrt");
  });

  it("answers a re-send whose link broke off in transit as of unknown outcome", async () => {
    mail.answerWith(() => "lost");

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res).toStrictEqual(outcomeUnknown());
  });

  /* Judged before the mint: a round trip to be told what the panel can already see is one nobody
     owes, and a mint whose message cannot leave stamps a send day for a message that never went. */
  it("refuses a row with no address without minting anything", async () => {
    row = withRow(null);

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success).toBe(false);
    expect(res.success ? "" : res.error).toMatch(/keine verwendbare E-Mail-Adresse hinterlegt/);
    expect(mints()).toStrictEqual([]);
    expect(mail.sent).toStrictEqual([]);
  });

  it("refuses a row the read no longer finds", async () => {
    row = () => refusedOn(ROW_OPERATION, "DB-COMMON-001");

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success).toBe(false);
    expect(res.success ? "" : res.error).toMatch(/gibt es nicht mehr/);
    expect(mints()).toStrictEqual([]);
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
        throw refusedOn(MINT_OPERATION, code);
      };

      const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

      expect(res.success).toBe(false);
      expect(res.success ? "" : res.error).toMatch(fragment);
      expect(mail.sent).toStrictEqual([]);
    });
  }

  /* The one refusal here that no endpoint publishes, so `publishedRefusals` never reaches it and a verb
     drifting back would stand unseen beside the sentences that say „senden“. */
  it("names the send in the league's own verb where the mint was not acknowledged", async () => {
    mint = () => ({ acknowledged: 0, bestaetigung: minted("anna@example.de") });

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success).toBe(false);
    expect(res.success ? "" : res.error).toMatch(/Der Bestätigungslink wurde nicht gesendet/);
    expect(mail.sent).toStrictEqual([]);
  });

  it("refuses a payload that is no identifier, without reaching the endpoint", async () => {
    const res = await einladeSchiedsrichterAction({ id: "nicht-hex" });

    expect(res.success).toBe(false);
    expect(mints()).toStrictEqual([]);
  });
});

const ENTWURF = { name: "Anna Meier", default_payment: 20, schule: null, kontakt: { email: "anna@example.de", telefon: null } };

describe("what the create tells the administrator", () => {
  it("reports the message the mint sent rather than the title the toast already carries", async () => {
    const res = await postSchiedsrichterAction(ENTWURF);

    expect(res.success && res.message).toBe(describeLinkMail("anna@example.de", "gesendet"));
  });

  it("answers a create whose link broke off in transit as of unknown outcome", async () => {
    mail.answerWith(() => "lost");

    const res = await postSchiedsrichterAction(ENTWURF);

    expect(res).toStrictEqual(outcomeUnknown());
  });

  /* The cleared box submits `null`: refused on that box in German, before the endpoint is reached,
     because a referee entered without an address is a person never told of it. */
  it("refuses a create without an address on the address box, reaching no endpoint and mailing nothing", async () => {
    create = () => {
      throw new Error("the create reached the endpoint");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: null, telefon: null } });

    expect(res.success).toBe(false);
    expect(res.success ? undefined : res.fieldErrors?.["kontakt.email"]).toBe("Bitte gib eine E-Mail-Adresse ein.");
    expect(mail.sent).toStrictEqual([]);
  });

  /* A label RFC 5890 reserves passes the form's rule and only the API refuses it: its 422 names the box,
     and the create answers there rather than in a toast naming no field. */
  it("puts an address only the API refuses on the address box, mailing nothing", async () => {
    create = () => {
      throw refusedPayload([bodyField(["kontakt", "email"])], "/schiedsrichter");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: "anna@ab--cd.de", telefon: null } });

    expect(res.success).toBe(false);
    expect(res.success ? undefined : res.fieldErrors).toStrictEqual({ "kontakt.email": FELD_ABGELEHNT });
    expect(mail.sent).toStrictEqual([]);
  });
});

describe("a save carrying no address", () => {
  // Each payload declares its own `kontakt`, so a save redeclaring the address as optional passes
  // every create case and lets an edit clear the only route by which the person learns of the entry.
  it("is refused on the address box, before the endpoint", async () => {
    save = () => {
      throw new Error("the save reached the endpoint");
    };

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID, kontakt: { email: null, telefon: null } });

    expect(res.success).toBe(false);
    expect(res.success ? undefined : res.fieldErrors?.["kontakt.email"]).toBe("Bitte gib eine E-Mail-Adresse ein.");
    expect(mail.sent).toStrictEqual([]);
  });
});

/* Driven here rather than at the editor, whose case answers a DOUBLE of this action: a save
   reporting nothing about the link it sent leaves the administrator with no record that a message
   went to a corrected address. */
describe("what the save hands the editor about the message it sent", () => {
  it("reports the send's own sentence beside the standard one", async () => {
    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    expect(res.success && res.message).toBe("Schiedsrichter bearbeitet");
    expect(res.success && res.versandSatz).toBe(describeLinkMail("korrigiert@example.de", "gesendet"));
    expect(res.success && res.versand).toBe("gesendet");
  });

  it("reports a send that did not leave, so the editor can grade its toast", async () => {
    mail.answerWith(() => "refused");

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    expect(res.success && res.versandSatz).toBe(describeLinkMail("korrigiert@example.de", "fehlgeschlagen"));
    expect(res.success && res.versand).toBe("fehlgeschlagen");
  });

  /* Outside production every send is withheld: filed by the deployment, never a failure of the mailbox. */
  it("reports no failure where this deployment withheld the send, and says so in the deployment's words", async () => {
    mail.answerWith(() => "withheld");

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    expect(res.success && res.versandSatz).toBe(ZURUECKGEHALTEN);
    expect(res.success && res.versand).toBe("zurueckgehalten");
  });

  /* A link whose connection broke off may have reached the provider: `mailSchiedsrichterLink`'s own
     reading is a failure, and only the request's mark keeps the save from reporting one. */
  it("answers a save whose link broke off in transit as of unknown outcome", async () => {
    mail.answerWith(() => "lost");

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    expect(res).toStrictEqual(outcomeUnknown());
  });

  it("hands over no sentence where the save minted nothing", async () => {
    save = () => ({
      acknowledged: 1,
      updated_document: stored("anna@example.de"),
      fanned_out_to_spiele: 0,
      bestaetigung: null,
    });

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    expect(res.success && res.versandSatz).toBe(undefined);
    expect(mail.sent).toStrictEqual([]);
  });
});

/* A retired referee's save stores a new address and mails nothing, so coming back is what asks an
   unanswered one: the link the reactivation minted is mailed here, or nobody ever sends it. */
describe("the reactivation of an unanswered referee", () => {
  it("mails the link the reactivation minted, to the address the mint read, and says so", async () => {
    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success && res.message).toBe(describeLinkMail("anna@example.de", "gesendet"));
    expect(mail.sent.map(({ to, tags }) => ({ to, zielId: tags?.ziel_id }))).toStrictEqual([
      { to: "anna@example.de", zielId: SCHIEDSRICHTER_ID },
    ]);
    expect(res.success && res.versand).toBe("gesendet");
  });

  it("reports a link that did not leave, so the row can grade its toast", async () => {
    mail.answerWith(() => "refused");

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success && res.message).toBe(describeLinkMail("anna@example.de", "fehlgeschlagen"));
    expect(res.success && res.versand).toBe("fehlgeschlagen");
  });

  it("answers a reactivation whose link broke off in transit as of unknown outcome", async () => {
    mail.answerWith(() => "lost");

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res).toStrictEqual(outcomeUnknown());
  });

  it("mails nothing where the row came back unasked", async () => {
    reactivate = () => ({ acknowledged: 1, updated_document: stored("anna@example.de"), bestaetigung: null });

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success && res.message).toBe("Schiedsrichter reaktiviert");
    expect(mail.sent).toStrictEqual([]);
  });

  it("words the ban the mint on return is refused on", async () => {
    reactivate = () => {
      throw refusedOn(REACTIVATE_OPERATION, "REQ-SCHIEDSRICHTER-007");
    };

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success).toBe(false);
    expect(res.success ? "" : res.error).toMatch(/Sperrliste/);
    expect(mail.sent).toStrictEqual([]);
  });
});
