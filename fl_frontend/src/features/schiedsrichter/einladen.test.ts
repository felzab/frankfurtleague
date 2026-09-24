import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

const asModule = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;

/* Replaced at the module boundary rather than the action being reshaped to admit a seam: the real
   client reaches a backend no test process runs, and the real mailer reaches a provider. */
const AUTH = `export const getAdminSession = async () => globalThis.__flEinladenSession;`;
const LOGGING = `export const logger = { info: () => {}, warn: () => {}, error: () => {} };`;
const NOTIFICATIONS = `export const mailSchiedsrichterLink = async (args) => { globalThis.__flEinladenMails.push(args); return globalThis.__flEinladenDelivered; };
export const describeLinkMail = (email, delivered) => (delivered ? \`ging an \${email}\` : \`nicht an \${email}\`);`;
const QUERIES = `export const getSchiedsrichterById = async (id) => globalThis.__flEinladenRow(id);`;
const MUTATIONS = `export const einladeSchiedsrichter = async (payload) => { globalThis.__flEinladenCalls.push(payload); return globalThis.__flEinladenMint(); };
export const postSchiedsrichter = async () => globalThis.__flEinladenCreate();
export const patchSchiedsrichter = async () => globalThis.__flEinladenSave();
export const deleteSchiedsrichter = async () => ({ acknowledged: 1 });
export const reactivateSchiedsrichter = async () => globalThis.__flEinladenReactivate();
export const anonymiseSchiedsrichter = async () => ({ acknowledged: 1 });`;

type MailArgs = { email: string; schiedsrichterId: string; name: string | null };

const recorders = globalThis as unknown as Record<string, unknown>;
const mails: MailArgs[] = [];
const calls: { id: string }[] = [];
recorders.__flEinladenMails = mails;
recorders.__flEinladenCalls = calls;

const PACKAGE_DOUBLES: Record<string, string> = {
  "server-only": "export {};",
  "next/cache": `export const refresh = () => {}; export const updateTag = () => {}; export const revalidateTag = () => {};`,
  "next/headers": `export const headers = async () => new Headers();`,
  "next/navigation": `export const unstable_rethrow = () => {};`,
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    const double = PACKAGE_DOUBLES[specifier];
    return double === undefined ? nextResolve(specifier, context) : { url: asModule(double), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/auth.ts")) return { format: "module", source: AUTH, shortCircuit: true };
    if (url.endsWith("/src/core/logging.ts")) return { format: "module", source: LOGGING, shortCircuit: true };
    if (url.endsWith("/src/features/schiedsrichter/notifications.ts")) return { format: "module", source: NOTIFICATIONS, shortCircuit: true };
    if (url.endsWith("/src/features/schiedsrichter/queries.ts")) return { format: "module", source: QUERIES, shortCircuit: true };
    if (url.endsWith("/src/features/schiedsrichter/mutations.ts")) return { format: "module", source: MUTATIONS, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const { einladeSchiedsrichterAction, patchSchiedsrichterAction, postSchiedsrichterAction, reactivateSchiedsrichterAction } =
  await import("./actions.ts");
const { APIBadStatusError } = await import("@/core/errors.ts");
const { FELD_ABGELEHNT } = await import("@/shared/utils/actionError.ts");
const { bodyField, refusedPayload } = await import("@/shared/testing/refusedPayload.ts");

const SCHIEDSRICHTER_ID = "6890a1b2c3d4e5f607800001";

const aRefusal = (serverErrorCode: string) =>
  new APIBadStatusError({
    message: "refused",
    url: "http://localhost/schiedsrichter",
    statusCode: 409,
    serverErrorCode,
    endpoint: "/schiedsrichter",
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

const withRow =
  (email: string | null, name: string | null = "Anna Meier") =>
  () => ({
    acknowledged: 1,
    schiedsrichter: { id: SCHIEDSRICHTER_ID, name, kontakt: { email, telefon: null } },
  });

beforeEach(() => {
  mails.length = 0;
  calls.length = 0;
  recorders.__flEinladenSession = { user: { email: "admin@example.de" } };
  recorders.__flEinladenRow = withRow("anna@example.de");
  recorders.__flEinladenMint = () => ({ acknowledged: 1, bestaetigung: { token: "abc", frist: "2026-10-05", email: "anna@example.de" } });
  recorders.__flEinladenCreate = () => ({
    acknowledged: 1,
    created_id: SCHIEDSRICHTER_ID,
    bestaetigung: { token: "abc", frist: "2026-10-05", email: "anna@example.de" },
  });
  // A DIFFERENT address from the one `ENTWURF` carries: the save writes the correction and the mint
  // reads it back, so a site mailing the payload instead would be visible here.
  recorders.__flEinladenSave = () => ({
    acknowledged: 1,
    updated_document: null,
    fanned_out_to_spiele: 0,
    bestaetigung: { token: "abc", frist: "2026-10-05", email: "korrigiert@example.de" },
  });
  recorders.__flEinladenReactivate = () => ({
    acknowledged: 1,
    updated_document: { name: "Anna Meier" },
    bestaetigung: { token: "abc", frist: "2026-10-05", email: "anna@example.de" },
  });
  recorders.__flEinladenDelivered = true;
});

describe("the re-send the editor's panel presses", () => {
  it("mints once and mails the stored address", async () => {
    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, true);
    assert.deepEqual(calls, [{ id: SCHIEDSRICHTER_ID }]);
    assert.deepEqual(
      mails.map((mail) => mail.email),
      ["anna@example.de"],
    );
  });

  /* The row is read before the mint, so a save landing between the two moved the mailbox this link
     was made for; the answer is the only reader that saw the write's own transaction. */
  it("mails the address the MINT names, not the one the earlier read returned", async () => {
    recorders.__flEinladenMint = () => ({
      acknowledged: 1,
      bestaetigung: { token: "abc", frist: "2026-10-05", email: "inzwischen@example.de" },
    });

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.deepEqual(
      mails.map((mail) => mail.email),
      ["inzwischen@example.de"],
    );
    assert.match(res.success ? res.message : "", /inzwischen@example\.de/);
  });

  it("says the previous link is dead whichever way the send went", async () => {
    for (const delivered of [true, false]) {
      recorders.__flEinladenDelivered = delivered;
      const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

      assert.match(res.success ? res.message : "", /Der vorherige Link gilt nicht mehr\./);
    }
  });

  /* Judged before the mint: a round trip to be told what the panel can already see is one nobody
     owes, and a mint whose message cannot leave stamps a send day for a message that never went. */
  it("refuses a row with no address without minting anything", async () => {
    recorders.__flEinladenRow = withRow(null);

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /keine verwendbare E-Mail-Adresse hinterlegt/);
    assert.deepEqual(calls, []);
    assert.deepEqual(mails, []);
  });

  it("refuses a row the read no longer finds", async () => {
    recorders.__flEinladenRow = () => null;

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /gibt es nicht mehr/);
    assert.deepEqual(calls, []);
  });

  /* Every refusal the endpoint declares, worded at the panel rather than falling through to the
     shared 409 sentence, which tells the administrator an equivalent entry exists. */
  for (const [code, fragment] of [
    ["REQ-SCHIEDSRICHTER-001", /stillgelegt/],
    ["REQ-SCHIEDSRICHTER-004", /schon bestätigt/],
    ["REQ-SCHIEDSRICHTER-006", /keine verwendbare E-Mail-Adresse hinterlegt/],
    ["REQ-SCHIEDSRICHTER-007", /Sperrliste/],
  ] as const) {
    it(`words ${code} at the panel, and mails nothing`, async () => {
      recorders.__flEinladenMint = () => {
        throw aRefusal(code);
      };

      const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

      assert.equal(res.success, false);
      assert.match(res.success ? "" : res.error, fragment);
      assert.deepEqual(mails, []);
    });
  }

  /* The one refusal here that no endpoint publishes, so `publishedRefusals` never reaches it and a verb
     drifting back would stand unseen beside the four sentences that say „senden“. */
  it("names the send in the league's own verb where the mint was not acknowledged", async () => {
    recorders.__flEinladenMint = () => ({ acknowledged: 0, bestaetigung: null });

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /Der Bestätigungslink wurde nicht gesendet/);
    assert.deepEqual(mails, []);
  });

  it("refuses a payload that is no identifier, without reaching the endpoint", async () => {
    const res = await einladeSchiedsrichterAction({ id: "nicht-hex" });

    assert.equal(res.success, false);
    assert.deepEqual(calls, []);
  });
});

const ENTWURF = { name: "Anna Meier", default_payment: 20, schule: null, kontakt: { email: "anna@example.de", telefon: null } };

describe("what the create tells the administrator", () => {
  it("reports the message the mint sent rather than the title the toast already carries", async () => {
    const res = await postSchiedsrichterAction(ENTWURF);

    assert.equal(res.success && res.message, "ging an anna@example.de");
  });

  /* The cleared box submits `null`: refused on that box in German, before the endpoint is reached,
     because a referee entered without an address is a person never told of it. */
  it("refuses a create without an address on the address box, reaching no endpoint and mailing nothing", async () => {
    recorders.__flEinladenCreate = () => {
      throw new Error("the create reached the endpoint");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: null, telefon: null } });

    assert.equal(res.success, false);
    assert.equal(res.success ? undefined : res.fieldErrors?.["kontakt.email"], "Bitte gib eine E-Mail-Adresse ein.");
    assert.deepEqual(mails, []);
  });

  /* A reserved domain passes the form's rule and only the API refuses it: its 422 names the box, and
     the create answers there rather than in a toast naming no field. */
  it("puts an address only the API refuses on the address box, mailing nothing", async () => {
    recorders.__flEinladenCreate = () => {
      throw refusedPayload([bodyField(["kontakt", "email"])], "/schiedsrichter");
    };

    const res = await postSchiedsrichterAction({ ...ENTWURF, kontakt: { email: "anna@beispiel.test", telefon: null } });

    assert.equal(res.success, false);
    assert.deepEqual(res.success ? undefined : res.fieldErrors, { "kontakt.email": FELD_ABGELEHNT });
    assert.deepEqual(mails, []);
  });
});

/* The placeholder a row without an address is given, which the API refuses with a 422 whose box gets
   only the generic sentence: refused here instead, the box says the placeholder is what has to change. */
describe("a save still carrying the placeholder address", () => {
  it("is refused on the address box in German, before the endpoint", async () => {
    recorders.__flEinladenSave = () => {
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
    assert.deepEqual(mails, []);
  });

  // Each payload declares its own `kontakt`, so a save redeclaring the address as optional passes
  // every create case and lets an edit clear the only route by which the person learns of the entry.
  it("is refused on the address box without an address as well, before the endpoint", async () => {
    recorders.__flEinladenSave = () => {
      throw new Error("the save reached the endpoint");
    };

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID, kontakt: { email: null, telefon: null } });

    assert.equal(res.success, false);
    assert.equal(res.success ? undefined : res.fieldErrors?.["kontakt.email"], "Bitte gib eine E-Mail-Adresse ein.");
    assert.deepEqual(mails, []);
  });
});

/* Driven here rather than at the editor, whose case answers a DOUBLE of this action: a save
   reporting nothing about the link it sent leaves the administrator with no record that a message
   went to a corrected address. */
describe("what the save hands the editor about the message it sent", () => {
  it("reports the send's own sentence beside the standard one", async () => {
    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.message, "Schiedsrichter bearbeitet");
    assert.equal(res.success && res.versandSatz, "ging an korrigiert@example.de");
    assert.equal(res.success && res.versandFehlgeschlagen, false);
  });

  it("marks a send that did not leave, so the editor can grade its toast", async () => {
    recorders.__flEinladenDelivered = false;

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.versandSatz, "nicht an korrigiert@example.de");
    assert.equal(res.success && res.versandFehlgeschlagen, true);
  });

  it("hands over no sentence where the save minted nothing", async () => {
    recorders.__flEinladenSave = () => ({ acknowledged: 1, updated_document: null, fanned_out_to_spiele: 0, bestaetigung: null });

    const res = await patchSchiedsrichterAction({ ...ENTWURF, id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.versandSatz, undefined);
    assert.deepEqual(mails, []);
  });
});

/* A retired referee's save stores a new address and mails nothing, so coming back is what asks an
   unanswered one: the link the reactivation minted is mailed here, or nobody ever sends it. */
describe("the reactivation of an unanswered referee", () => {
  it("mails the link the reactivation minted, to the address the mint read, and says so", async () => {
    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.message, "ging an anna@example.de");
    assert.deepEqual(
      mails.map(({ email, schiedsrichterId }) => ({ email, schiedsrichterId })),
      [{ email: "anna@example.de", schiedsrichterId: SCHIEDSRICHTER_ID }],
    );
    assert.equal(res.success && res.versandFehlgeschlagen, false);
  });

  it("marks a link that did not leave, so the row can grade its toast", async () => {
    recorders.__flEinladenDelivered = false;

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.message, "nicht an anna@example.de");
    assert.equal(res.success && res.versandFehlgeschlagen, true);
  });

  it("mails nothing where the row came back unasked", async () => {
    recorders.__flEinladenReactivate = () => ({ acknowledged: 1, updated_document: { name: "Anna Meier" }, bestaetigung: null });

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success && res.message, "Schiedsrichter reaktiviert");
    assert.deepEqual(mails, []);
  });

  it("words the ban the mint on return is refused on", async () => {
    recorders.__flEinladenReactivate = () => {
      throw aRefusal("REQ-SCHIEDSRICHTER-007");
    };

    const res = await reactivateSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /Sperrliste/);
    assert.deepEqual(mails, []);
  });
});

/* The re-send takes the placeholder for no address before any round trip, and leaves a real address
   to the API. */
describe("the re-send of a row holding the placeholder", () => {
  it("is refused as having no address, reaching no endpoint", async () => {
    recorders.__flEinladenRow = withRow("adresse-fehlt@frankfurtleague.invalid");

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /keine verwendbare E-Mail-Adresse/);
    assert.deepEqual(calls, []);
    assert.deepEqual(mails, []);
  });

  /* A row stored before the address rule holds a real address the payload's rule refuses: whether a
     link may go there is the API's to answer, and its refusal reaches the panel in the same words. */
  it("asks the API about a row whose address predates the address rule, and words its refusal", async () => {
    recorders.__flEinladenRow = withRow("jürgen@schule.de");
    recorders.__flEinladenMint = () => {
      throw aRefusal("REQ-SCHIEDSRICHTER-006");
    };

    const res = await einladeSchiedsrichterAction({ id: SCHIEDSRICHTER_ID });

    assert.equal(calls.length, 1, "the re-send judged the address itself rather than asking the API");
    assert.equal(res.success, false);
    assert.match(res.success ? "" : res.error, /keine verwendbare E-Mail-Adresse/);
    assert.deepEqual(mails, []);
  });
});
