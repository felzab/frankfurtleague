import { cacheCalls, doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { doubleOutbox } from "@/test-support/mailDouble.ts";
import { beforeEach, describe, expect, it } from "vitest";

import type { ApiCall } from "@/test-support/apiClientDouble.ts";

/* The real actions, their mutations and reads, called: the request they run in, the backend client and the mailer
   are the doubles. The mailer's double also stills the drain behind the response, which the backend's Postausgang
   feeds: a write owing a link sends nothing itself. */
doubleActionRequest();
const mail = doubleOutbox();

/** What each endpoint answers in this case, returned or, where it is an `Error`, thrown. */
type Answer = () => unknown;
let row: Answer;
let mint: Answer;
let create: Answer;
let save: Answer;
let reactivate: Answer;

function answerFor({ endpoint, method }: ApiCall): unknown {
  if (method === "GET") return row();
  if (endpoint.endsWith("/invite")) return mint();
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
const { refused } = await import("@/test-support/refusals.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/test-support/refusedPayload.ts");

const SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607800001";

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
  confirmation: null,
  version: 0,
});

const withRow = (email: string | null, name?: string | null) => () => ({
  schiedsrichter: stored(email, name),
  confirmation_expired: false,
  address_change_id: null,
  address_change_viewable_denied: null,
  delivery: null,
});

/** The link a write owed `email`, as each such write answers it. */
const owed = (email: string) => ({ frist: "2026-10-05", email });

/** Every re-send the case sent. */
const mints = () => requestsOf(client.calls).filter(({ endpoint }) => endpoint.endsWith("/invite"));

beforeEach(() => {
  row = withRow("anna@example.de");
  mint = () => ({ confirmation: owed("anna@example.de") });
  create = () => ({ created_id: SCHIEDSRICHTER_ID, confirmation: owed("anna@example.de") });
  // A DIFFERENT address from the one `ENTWURF` carries: the save writes the correction and answers it back, so a
  // sentence naming the payload's address instead would be visible here.
  save = () => ({
    fanned_out_to_spiele: 0,
    confirmation: owed("korrigiert@example.de"),
  });
  reactivate = () => ({ confirmation: owed("anna@example.de") });
});

describe("the re-send the editor's panel presses", () => {
  it("asks the backend once and mails nothing itself", async () => {
    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success).toBe(true);
    expect(mints()).toStrictEqual([{ endpoint: `/schiedsrichter/${SCHIEDSRICHTER_ID}/confirmation/invite`, method: "POST", body: undefined }]);
    expect(mail.sent).toStrictEqual([]);
  });

  /* The write replaces the row's confirmation block, which the editor's panel shows, so the page is read again. */
  it("refreshes the editor's page after a re-send", async () => {
    expect(
      (await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID })).success,
      "the re-send never landed, so what it moves is judged on nothing",
    ).toBe(true);

    expect(cacheCalls.filter(({ name }) => name === "refresh")).toStrictEqual([{ name: "refresh", args: [] }]);
  });

  /* The row is read before the write, so a save landing between the two moved the mailbox the link goes to; the
     answer is the only reader that saw the write's own transaction. */
  it("names the address the write answered, not the one the earlier read returned, and says the previous link is dead", async () => {
    mint = () => ({ confirmation: owed("inzwischen@example.de") });

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success ? res.message : "").toMatch(/inzwischen@example\.de\. Der vorherige Link gilt nicht mehr\.$/);
  });

  /* Judged before the write: a round trip to be told what the panel can already see is one nobody owes. */
  it("refuses a row with no address without asking the backend", async () => {
    row = withRow(null);

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success).toBe(false);
    expect(res.success ? "" : res.error).toMatch(/keine verwendbare E-Mail-Adresse hinterlegt/);
    expect(mints()).toStrictEqual([]);
  });

  it("refuses a row the read no longer finds", async () => {
    row = () => refused("document_not_found");

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success).toBe(false);
    expect(res.success ? "" : res.error).toMatch(/gibt es nicht mehr/);
    expect(mints()).toStrictEqual([]);
  });

  /* Every refusal the endpoint declares, worded at the panel rather than falling through to the
     shared sentence, which names no rule. */
  for (const [code, fragment] of [
    ["schiedsrichter_retired", /stillgelegt/],
    ["confirmation_exists", /schon bestätigt/],
    ["schiedsrichter_no_adresse", /keine verwendbare E-Mail-Adresse hinterlegt/],
    ["schiedsrichter_adresse_barred", /Sperrliste/],
  ] as const) {
    it(`words ${code} at the panel`, async () => {
      mint = () => {
        throw refused(code);
      };

      const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

      expect(res.success).toBe(false);
      expect(res.success ? "" : res.error).toMatch(fragment);
    });
  }

  it("refuses a payload that is no identifier, without reaching the endpoint", async () => {
    const res = await einladeSchiedsrichterAction({ id: "nicht-hex" });

    expect(res.success).toBe(false);
    expect(mints()).toStrictEqual([]);
  });
});

const ENTWURF = { name: "Anna Meier", default_payment: 20, schule: null, kontakt: { email: "anna@example.de", telefon: null } };

describe("what the create tells the administrator", () => {
  it("names the address the link goes to rather than the title the toast already carries", async () => {
    const res = await postSchiedsrichterAction(ENTWURF);

    expect(res.success ? res.message : "").toMatch(/anna@example\.de/);
  });

  /* The cleared box submits `null`: refused on that box in German, before the endpoint is reached,
     because a referee entered without an address is a person never told of it. */
  it("refuses a create without an address on the address box, reaching no endpoint", async () => {
    create = () => {
      throw new Error("the create reached the endpoint");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: null, telefon: null } });

    expect(res.success).toBe(false);
    expect(res.success ? undefined : res.fieldErrors?.["kontakt.email"]).toBe("Bitte gib eine E-Mail-Adresse ein.");
  });

  /* A label RFC 5890 reserves passes the form's rule and only the API refuses it: its 422 names the box,
     and the create answers there rather than in a toast naming no field. */
  it("puts an address only the API refuses on the address box", async () => {
    create = () => {
      throw refusedPayload([bodyField(["kontakt", "email"])], "/schiedsrichter");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: "anna@ab--cd.de", telefon: null } });

    expect(res.success).toBe(false);
    expect(res.success ? undefined : res.fieldErrors).toStrictEqual({ "kontakt.email": FELD_ABGELEHNT });
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
  });
});

/* Driven here rather than at the editor, whose case answers a DOUBLE of this action: a save
   reporting nothing about the link it owed leaves the administrator with no record that a message
   goes to a corrected address. */
describe("what the save hands the editor about the link it owed", () => {
  it("names the corrected address beside the standard sentence", async () => {
    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    expect(res.success && res.message).toBe("Schiedsrichter bearbeitet");
    expect(res.success ? res.versandSatz : "").toMatch(/korrigiert@example\.de/);
  });

  it("hands over no sentence where the save owed no link", async () => {
    save = () => ({
      fanned_out_to_spiele: 0,
      confirmation: null,
    });

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    expect(res.success && res.versandSatz).toBe(undefined);
  });
});

/* A retired referee's save stores a new address and mails nothing, so coming back is what asks an
   unanswered one: the reactivation owes the link, and says where it goes. */
describe("the reactivation of an unanswered referee", () => {
  it("names the address the link it owed goes to", async () => {
    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success ? res.message : "").toMatch(/anna@example\.de/);
  });

  it("says only that it came back where the row came back unasked", async () => {
    reactivate = () => ({ confirmation: null });

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success && res.message).toBe("Schiedsrichter reaktiviert");
  });

  it("words the ban the return is refused on", async () => {
    reactivate = () => {
      throw refused("schiedsrichter_adresse_barred");
    };

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    expect(res.success).toBe(false);
    expect(res.success ? "" : res.error).toMatch(/Sperrliste/);
  });
});
