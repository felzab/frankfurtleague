import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { einwilligungAnswer, publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { doubleActionRequest } from "@/shared/testing/actionDoubles.ts";
import { doubleApiClient } from "@/shared/testing/apiClientDouble.ts";

import type { FLKontaktperson, FLKontaktpersonPayload, FLSaisonTeamKontakte } from "@/features/teams/schemas";
import type { FLPatchSaisonTeamKontaktePayload } from "./schemas";

/* Replaced at the module boundary rather than the action being reshaped to admit a seam: the real
   client reaches a backend no test process runs. */
const calls = doubleApiClient(({ endpoint }) => antwortFuer(endpoint));

doubleActionRequest();

const { patchSaisonTeamKontakteAction } = await import("./actions.ts");
const { BEWERBUNG_VERALTET } = await import("@/features/bewerbungen/utils.ts");

const TEAM_ID = `${"a".repeat(23)}1`;
const SAISON_ID = "2526";
const LAUFEND = publishedLaufendeFassung("bewerbung").text_version;
/** A label an older build stamped, whose words the backend still holds. */
const AELTER = "2026-09-bestaetigung-4";
/** What the person's own confirmation page stores, which is never the running application label. */
const BESTAETIGT = publishedLaufendeFassung("bestaetigung_kontakt").text_version;

let stored: FLSaisonTeamKontakte | null = null;

/** What the backend runs on each page in this case: the registry's own answer unless a case moves it. */
let seiten: () => unknown = () => einwilligungAnswer("/einwilligung/seiten");

function antwortFuer(endpoint: string): unknown {
  if (endpoint === "/einwilligung/seiten") return seiten();
  return endpoint === "/teams/memberships"
    ? { teams: [{ id: TEAM_ID, memberships: [{ saison_id: SAISON_ID, kontakte: stored, kontakte_stand: "stand" }] }] }
    : {
        acknowledged: 1,
        saison_id: SAISON_ID,
        team_id: TEAM_ID,
        saison_team_id: "c".repeat(24),
        kontakte: null,
        kontakte_stand: "neu",
        bestaetigungen: [],
        gesperrt: [],
      };
}

/** A number per person: two seats sharing one are refused as one person entered twice. */
const TELEFON: Record<string, string> = { Ada: "069 501", Grace: "069 502", Alan: "069 503" };

const storedSeat = (vorname: string, textVersion: string): FLKontaktperson => ({
  vorname,
  nachname: "Muster",
  email: `${vorname.toLowerCase()}@schule.example`,
  telefon: TELEFON[vorname] ?? "069 3333333",
  geburtsdatum: "1990-12-10",
  einwilligung: {
    umfang: "kontaktdaten",
    erfasst_von: "person",
    text_version: textVersion,
    datum: "2026-09-01",
    bestaetigt_am: "2026-09-02",
    medien: false,
    verlauf: [],
  },
});

/** A seat as the editor sends it, under whichever label it carries. */
const sentSeat = (vorname: string, textVersion: string): FLKontaktpersonPayload => ({
  vorname,
  nachname: "Muster",
  email: `${vorname.toLowerCase()}@schule.example`,
  telefon: TELEFON[vorname] ?? "069 3333333",
  einwilligung: { umfang: "kontaktdaten", text_version: textVersion, datum: "2026-09-01" },
});

const save = (kontakte: FLPatchSaisonTeamKontaktePayload["kontakte"]) =>
  patchSaisonTeamKontakteAction({ team_id: TEAM_ID, saison_id: SAISON_ID, kontakte, kontakte_stand: "stand" });

const wrote = (): boolean => calls.some(({ method }) => method === "PATCH");

beforeEach(() => {
  calls.length = 0;
  stored = null;
  seiten = () => einwilligungAnswer("/einwilligung/seiten");
});

describe("the labels a contacts save may carry", () => {
  /* The control: a block of new seats under the running label reaches the write, and no stored block
     is read for it, so a check refusing everything fails here rather than passing the refusals. */
  it("saves new seats under the running label without reading the stored block", async () => {
    const answer = await save({
      trainer: sentSeat("Ada", LAUFEND),
      ansprechperson: sentSeat("Grace", LAUFEND),
      stellvertretung: sentSeat("Alan", LAUFEND),
      trainer_ist_zugleich: null,
    });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.deepEqual(
      calls.map(({ endpoint }) => endpoint),
      ["/einwilligung/seiten", `/teams/${TEAM_ID}/saisons/${SAISON_ID}/kontakte`],
    );
  });

  /* Read per request: a frontend recreated before the backend would otherwise admit new seats under a
     label the backend has not reached yet, or has left. */
  it("judges a new seat's label against the one the backend runs on this request", async () => {
    seiten = () => ({ acknowledged: 1, laufende_fassungen: { bewerbung: AELTER } });

    const answer = await save({ trainer: sentSeat("Ada", LAUFEND), ansprechperson: null, stellvertretung: null, trainer_ist_zugleich: null });

    assert.notEqual(LAUFEND, AELTER, "the case moves nothing: the registry already runs that label");
    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.equal(wrote(), false);
  });

  /* A page opened before a deploy moved the label: the new person would be recorded under words the
     backend does not run. */
  it("refuses a new seat under an older label, writing nothing", async () => {
    stored = { trainer: null, ansprechperson: storedSeat("Grace", BESTAETIGT), stellvertretung: null, trainer_ist_zugleich: null };

    const answer = await save({
      trainer: sentSeat("Ada", AELTER),
      ansprechperson: sentSeat("Grace", BESTAETIGT),
      stellvertretung: null,
      trainer_ist_zugleich: null,
    });

    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.equal(wrote(), false);
  });

  /* The case the check exists to admit: every save of a block holding a confirmed seat sends that
     seat back under the confirmation page's label. */
  it("saves a confirmed seat under the label it stores", async () => {
    stored = {
      trainer: storedSeat("Ada", LAUFEND),
      ansprechperson: storedSeat("Grace", BESTAETIGT),
      stellvertretung: storedSeat("Alan", AELTER),
      trainer_ist_zugleich: null,
    };

    const answer = await save({
      trainer: sentSeat("Ada", LAUFEND),
      ansprechperson: sentSeat("Grace", BESTAETIGT),
      stellvertretung: sentSeat("Alan", AELTER),
      trainer_ist_zugleich: null,
    });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.equal(wrote(), true);
  });

  it("refuses a stored seat relabelled to a label it never stored, writing nothing", async () => {
    stored = { trainer: null, ansprechperson: storedSeat("Grace", BESTAETIGT), stellvertretung: null, trainer_ist_zugleich: null };

    const answer = await save({ trainer: null, ansprechperson: sentSeat("Grace", AELTER), stellvertretung: null, trainer_ist_zugleich: null });

    assert.deepEqual(answer, { success: false, error: BEWERBUNG_VERALTET });
    assert.equal(wrote(), false);
  });

  /* The Trainer the claim composes is a copy of the named seat, label included, so it is judged by
     what that seat stores rather than by a Trainer seat that may hold nobody. */
  it("judges a mirrored Trainer through the seat it copies", async () => {
    stored = { trainer: null, ansprechperson: storedSeat("Grace", BESTAETIGT), stellvertretung: null, trainer_ist_zugleich: null };

    const answer = await save({
      trainer: sentSeat("Grace", BESTAETIGT),
      ansprechperson: sentSeat("Grace", BESTAETIGT),
      stellvertretung: null,
      trainer_ist_zugleich: "ansprechperson",
    });

    assert.equal(answer.success, true, JSON.stringify(answer));
    assert.equal(wrote(), true);
  });
});
