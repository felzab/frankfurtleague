import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { APIBadStatusError, APINetworkError, RolledBackError } from "@/core/errors.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { cacheCalls, doubleActionRequest, loggedLines } from "@/shared/testing/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/shared/testing/apiClientDouble.ts";
import { assertEachAnswered, refusedOn } from "@/shared/testing/publishedRefusals.ts";

import type { ApiCall } from "@/shared/testing/apiClientDouble.ts";

/* The real actions and their mutations, called: the request they run in, the sign-in store and the backend
   client are the doubles. */
const request = doubleActionRequest();

/* Every message the league sends goes through this module; nothing on this page may reach it. Left unserved
   where nothing loads it, which is the answer the cases below want. */
const mailed: unknown[] = [];
registerDoubles(
  {
    modules: {
      "core/mail.ts": { sendMail: (mail: unknown) => void mailed.push(mail), sendSperreNotice: (mail: unknown) => void mailed.push(mail) },
    },
  },
  { mayGoUnserved: ["core/mail.ts"] },
);

/** What the erasure answers an address holding one squad row. */
const GELOESCHT = {
  acknowledged: 1,
  spieler: 1,
  saison_spieler: 1,
  schiedsrichter: 0,
  spiele: 0,
  kontakt_sitze: 0,
  registrierungen: 0,
  adresswechsel: 0,
  berechtigungen: 0,
  drosselung: 0,
};
const NICHTS = { ...GELOESCHT, spieler: 0, saison_spieler: 0 };

const ANSICHT = {
  acknowledged: 1,
  spieler: [],
  schiedsrichter: [],
  sitze: [],
  bewerbungen: [],
  registrierungen: [],
  adresswechsel: [],
  spieler_adresswechsel: [],
  verwaltung: null,
};

/** What the sign-in store had done when each backend call went out, in order: the order no render shows. */
const amAufruf: { endpoint: string; konten: readonly string[]; abgemeldet: readonly string[] }[] = [];

const answerOf = ({ endpoint }: ApiCall): unknown =>
  endpoint === "/identitaet/erasure" ? GELOESCHT : endpoint === "/identitaet/erasure/ansicht" ? ANSICHT : { acknowledged: 1 };

const client = doubleApiAnswers((call) => {
  amAufruf.push({ endpoint: call.endpoint, konten: request.deletedAccounts(), abgemeldet: request.signedOut() });
  return Promise.resolve(answerOf(call));
});

/** Every call answered by `next` for the rest of the case, the store's state still taken at each. */
const answerWith = (next: (call: ApiCall) => Promise<unknown>): void =>
  client.answerWith((call) => {
    amAufruf.push({ endpoint: call.endpoint, konten: request.deletedAccounts(), abgemeldet: request.signedOut() });
    return next(call);
  });

/** A refusal as the client raises one, at a status of the case's choosing: the document is not consulted. */
const refused = (endpoint: string, serverErrorCode: string, statusCode = 403): APIBadStatusError =>
  new APIBadStatusError({
    message: "refused",
    url: `http://backend/api/v0${endpoint}`,
    statusCode,
    serverErrorCode,
    endpoint,
    method: "POST",
    readOnly: false,
    traceId: "0",
  });

const unreachable = (): APINetworkError =>
  new APINetworkError({ message: "down", url: "http://backend", method: "POST", readOnly: false, traceId: "0", isTimeout: false });

/* Reached with `await import` and never a static import beside the doubles, which register as they evaluate. */
const { eraseAufAnfrageAction, endAnmeldungenAction, readErasureAnsichtAction } = await import("./actions.ts");
const { mapAbmeldungRefusal, mapErasureRefusal } = await import("./refusals.ts");

const ADRESSE = "Ada.Byron@Example.org";
const ANLASS = "E-Mail vom 12.10.2026, Betreff Löschung meiner Daten";

const erase = () => eraseAufAnfrageAction({ email: ADRESSE, anlass: ANLASS });

describe("the erasure on request", () => {
  /* The account last, once the league's records are gone: an account deleted ahead of a refused erasure leaves a
     person whose data stands and who then cannot sign in to ask again. */
  it("sends the backend's erasure before it deletes the account, and deletes the address it sent", async () => {
    amAufruf.length = 0;

    const result = await erase();

    assert.equal(result.success, true);
    assert.deepEqual(
      amAufruf.map(({ endpoint, konten }) => ({ endpoint, konten })),
      [{ endpoint: "/identitaet/erasure", konten: [] }],
      "the account went before the backend was asked",
    );
    assert.deepEqual(request.deletedAccounts(), [ADRESSE]);
    assert.deepEqual(
      requestsOf(client.calls).map(({ body }) => body),
      [{ email: ADRESSE, anlass: ANLASS }],
    );
  });

  /* A barred person cannot sign in to delete their own account, so this erasure deletes it at once as any other's.
     Every read that could report the ban says the address is barred. */
  it("deletes a barred address's account as any other's", async () => {
    const gesperrt = { acknowledged: 1, gesperrt: true };
    const subjekt = {
      ...gesperrt,
      sitze: [],
      spieler: [],
      schiedsrichter: [],
      unbestaetigt: false,
      verwaltung: null,
      berechtigt_seit: null,
      inhaber_seit: null,
    };
    answerWith((call) =>
      Promise.resolve(call.endpoint === "/identitaet/gesperrt" ? gesperrt : call.endpoint === "/identitaet/subjekt" ? subjekt : answerOf(call)),
    );

    const result = await erase();

    assert.equal(result.success, true);
    assert.deepEqual(request.deletedAccounts(), [ADRESSE], "a barred address kept its account");
  });

  it("deletes no account where the backend refused the erasure", async () => {
    answerWith(() => Promise.reject(refused("/identitaet/erasure", "REQ-PURGE-003")));

    const result = await erase();

    assert.equal(result.success, false);
    assert.deepEqual(request.deletedAccounts(), [], "a refused erasure deleted the account");
  });

  it("deletes no account where the backend's answer never came", async () => {
    answerWith(() => Promise.reject(unreachable()));

    const result = await erase();

    assert.equal(result.success, false);
    assert.deepEqual(request.deletedAccounts(), [], "an erasure of unknown outcome deleted the account");
  });

  /* An erased pupil or referee leaves the squad lists and the fixtures cached for the public pages. */
  it("drops the squads' and the fixtures' cached reads", async () => {
    await erase();

    const dropped = cacheCalls.filter(({ name }) => name === "updateTag").map(({ args }) => args[0]);
    assert.ok(dropped.includes("spieler"), "the cached squads still list the erased pupil");
    assert.ok(dropped.includes("spiele"), "the cached fixtures still name the erased referee");
  });

  /* The records are gone and the account stands, which a repeat completes: the backend answers an emptied
     address with zeros. The line names the failure and never the address. */
  it("tells the administrator the account stands where its deletion rolled back, logging no address", async () => {
    request.failAccountDeletion(new RolledBackError(new Error(`deletion of ${ADRESSE} failed`)));

    const result = await erase();

    assert.equal(result.success, true, "the erasure's own success went unreported");
    assert.equal("konto" in result ? result.konto : undefined, "nichtGeloescht");
    assert.match("message" in result ? result.message : "", /Lösche die Adresse erneut/);
    const zeile = loggedLines.find(({ meta }) => (meta as { error_code?: string } | undefined)?.error_code === "FE-AUTH-012");
    assert.ok(zeile !== undefined, "the failed deletion was logged under no code");
    assert.doesNotMatch(JSON.stringify(loggedLines).toLowerCase(), /ada\.byron@example\.org/, "an address reached the log stream");
  });

  /* A failure past the callback came from the commit, which may have landed: a result saying the account stands may
     be false. The repeat completes either way. */
  it("calls the account's fate unclear where its deletion failed at the commit", async () => {
    request.failAccountDeletion(new Error(`commit for ${ADRESSE} failed`));

    const result = await erase();

    assert.equal("konto" in result ? result.konto : undefined, "unklar");
    assert.match("message" in result ? result.message : "", /ist unklar\. Lösche die Adresse erneut/);
  });

  /* No count covers the log's and the authorship's rewrite, which reach an address holding no record too: an answer
     to the person must not read that nothing was held. */
  it("says no record was held and the log was cleaned anyway where the address held no record and no account", async () => {
    answerWith(() => Promise.resolve(NICHTS));
    request.holdNoAccount();

    const result = await erase();
    const satz = "message" in result ? result.message : "";

    assert.equal(result.success, true);
    assert.equal("gespeichert" in result ? result.gespeichert : undefined, false);
    assert.match(satz, /^Unter dieser Adresse war kein Eintrag gespeichert, und sie hatte kein Konto\. /);
    assert.match(satz, /Im Änderungsprotokoll .* ist sie trotzdem gelöscht\.$/, "the result reads as an erasure that did nothing");
  });

  /* An erased referee's unplayed fixtures stand with nobody to officiate, the one thing the result asks its reader to
     act on. `spiele` counts the played ones moved too, so the sentence claims none. */
  it("sends the administrator to „Handlungsbedarf“ where an erased referee's fixtures moved, if any was unplayed", async () => {
    answerWith(() => Promise.resolve({ ...NICHTS, schiedsrichter: 1, spiele: 2 }));

    const result = await erase();

    assert.match(
      "message" in result ? result.message : "",
      /War diese Person für Spiele ohne Ergebnis eingeteilt, brauchen diese Spiele eine neue Einteilung\. Du findest sie unter „Handlungsbedarf“\./,
    );
  });

  it("mails nobody", async () => {
    await erase();

    assert.deepEqual(mailed, []);
  });

  it("answers every refusal the erasure publishes through its mapper", async () => {
    await assertEachAnswered({ operation: "POST /identitaet/erasure", refuseWith: answerWith, act: erase, mapped: mapErasureRefusal });
    assert.deepEqual(request.deletedAccounts(), [], "a refused erasure deleted an account");
  });

  /* The typed Anlass is what the rule refuses, so the sentence lands under its box rather than in a banner. */
  it("marks the Anlass box where the backend finds a name of the person in it", async () => {
    answerWith(() => Promise.reject(refusedOn("POST /identitaet/erasure", "REQ-PURGE-006")));

    const result = await erase();

    assert.deepEqual(result.success ? undefined : result.fieldErrors, { anlass: "Der Anlass darf keinen Namen der Person enthalten." });
    assert.deepEqual(request.deletedAccounts(), [], "a refused erasure deleted the account");
  });
});

describe("the reveal read as the erasure arms", () => {
  /* The page says so before anyone arms: the reveal judges the operator's own address as the erasure does. */
  it("words the operator's own address in the erasure's sentence", async () => {
    answerWith(() => Promise.reject(refused("/identitaet/erasure/ansicht", "REQ-PURGE-003")));

    const result = await readErasureAnsichtAction({ email: ADRESSE });

    assert.equal(result.success, false);
    assert.match(result.success ? "" : result.error, /^Deine eigene Adresse löschst Du nicht hier\./);
  });

  it("declares itself a read, sending the address in its body", async () => {
    await readErasureAnsichtAction({ email: ADRESSE });

    assert.deepEqual(requestsOf(client.calls), [
      { endpoint: "/identitaet/erasure/ansicht", method: "POST", body: { email: ADRESSE }, readOnly: true },
    ]);
  });

  it("answers every refusal the reveal publishes through the erasure's mapper", async () => {
    await assertEachAnswered({
      operation: "POST /identitaet/erasure/ansicht",
      refuseWith: answerWith,
      act: () => readErasureAnsichtAction({ email: ADRESSE }),
      mapped: mapErasureRefusal,
      readOnly: true,
    });
  });
});

describe("the sign-out of one address", () => {
  const abmelden = () => endAnmeldungenAction({ email: ADRESSE });

  /* The log's row first: the backend judges whose address it is, and a sign-out it refused must end nothing. */
  it("ends the typed address's sessions once the backend filed the row, and mails nobody", async () => {
    amAufruf.length = 0;

    const result = await abmelden();

    assert.equal(result.success, true);
    assert.deepEqual(
      amAufruf.map(({ endpoint, abgemeldet }) => ({ endpoint, abgemeldet })),
      [{ endpoint: "/identitaet/abmeldung", abgemeldet: [] }],
    );
    assert.deepEqual(request.signedOut(), [ADRESSE]);
    assert.deepEqual(mailed, [], "the sign-out mailed somebody");
  });

  it("ends nothing where the backend refused the address", async () => {
    answerWith(() => Promise.reject(refused("/identitaet/abmeldung", "REQ-PURGE-003")));

    const result = await abmelden();

    assert.deepEqual(request.signedOut(), [], "a refused sign-out ended sessions");
    assert.equal(result.success ? "" : result.error, "Deine eigenen Anmeldungen beendest Du auf Deiner Kontoseite.");
  });

  it("says the address holds no account where it holds none", async () => {
    request.holdNoAccount();

    const result = await abmelden();

    assert.equal(result.success, true);
    assert.equal("konto" in result ? result.konto : undefined, false);
  });

  it("says the sessions live on where the store did not end them, logging no address", async () => {
    request.failSignOut(new Error(`sessions of ${ADRESSE} stand`));

    const result = await abmelden();

    assert.equal(result.success ? "" : result.error, "Laufende Anmeldungen der Adresse konnten nicht beendet werden.");
    assert.ok(loggedLines.some(({ meta }) => (meta as { error_code?: string } | undefined)?.error_code === "FE-AUTH-006"));
    assert.doesNotMatch(JSON.stringify(loggedLines).toLowerCase(), /ada\.byron@example\.org/, "an address reached the log stream");
  });

  it("answers every refusal the sign-out publishes through its own mapper", async () => {
    await assertEachAnswered({ operation: "POST /identitaet/abmeldung", refuseWith: answerWith, act: abmelden, mapped: mapAbmeldungRefusal });
    assert.deepEqual(request.signedOut(), [], "a refused sign-out ended sessions");
  });
});
