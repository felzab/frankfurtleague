import { doubleActionRequest, doubleActions } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { laufendeFassung } from "@/test-support/einwilligungRegistry.ts";
import { kenntnisnahme } from "@/test-support/kenntnisnahme.ts";
import { doubleOutbox } from "@/test-support/mailDouble.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, refusalCodes, refused } from "@/test-support/refusals.ts";
import { assert, beforeEach, describe, expect, it, vi } from "vitest";

import { APINetworkError } from "@/core/errors.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import { labelBadge } from "../../shared/components/ui/badges.ts";
import { buildTeamBanners } from "../teams/components/forms/AdminTeamEditForm/banners.ts";
import { mapAlreadyEnteredRefusal, mapCreatedClubEntryRefusal, mapEntryRefusal, mapReplacementRefusal } from "../teams/refusals.ts";
import { ADRESSE_KORRIGIEREN, BEWERBUNG_GRUND_MAX_LENGTH, ERNEUT_OHNE_ADRESSE } from "./constants.ts";
import { mapEinwilligungErneutRefusal, mapKontaktEmailRefusal, mapKontaktSitzRefusal, mapTriageRefusal } from "./refusals.ts";
import { FLAblehnenBewerbungPayloadSchema } from "./schemas.ts";

import type { Code, FLBewerbung } from "@/core/generated/client/types.ts";
import type { TeamSaisonMembership } from "../teams/types.ts";

const BEWERBUNG_ID = "68c1f0a2b3c4d5e6f7a8b9c0";
const PERSON = { vorname: "Anna", email: "anna@example.de" };

/**
 * The application the three contact repairs read before their write: a proposed school, whose name
 * needs no club list, and a seat holding a person with an address, so each repair reaches its write.
 */
const GELESEN = {
  bewerbung: { saison_id: "2026", schule: { team_name: "Gymnasium Beispiel" }, team_id: null, kontakte: { ansprechperson: PERSON } },
};

/** The same application naming a club the league already holds rather than a new school. */
const GEWAEHLT = { bewerbung: { ...GELESEN.bewerbung, schule: null, team_id: "6890a1b2c3d4e5f607182932" } };

/** An acceptance of the application, whatever its group. */
const ANNAHME = { id: BEWERBUNG_ID, gruppe: "A", trikot_farbe: null } as const;

/** The triage mapper as the acceptance asks it about `GELESEN`, a proposed school. */
const acceptanceMapped = (refusal: unknown) => mapTriageRefusal(refusal, "neue_schule");

/** The triage mapper as the decline asks it, entering nothing. */
const declineMapped = (refusal: unknown) => mapTriageRefusal(refusal, null);

/** What a failed action says, or nothing where it succeeded. */
const errorOf = (result: { success: boolean; error?: string }): string => result.error ?? "";

/** The origin this run is configured with, which no published address shares. */
const ORIGIN = "http://localhost:3000";
/** Every argument each logger call was handed, whatever its level. */
const logged: unknown[][] = [];
const record = (...args: unknown[]): void => void logged.push(args);
/** The fields of each line the acceptance's read of the colliding application wrote. */
const collisionReadLines = (): { name?: unknown }[] =>
  logged.filter(([message]) => message === "bewerbung.collision_unread").map(([, , meta]) => meta as { name?: unknown });
const CONFIG_DOUBLE = { frontend_config: { AUTH_URL: ORIGIN } };
const LOGGER_DOUBLE = { logger: { debug: record, info: record, warn: record, error: record } };

/* The real actions and their mutations, called: the request they run in, the application three of
   them read first, the club list and the backend client are the doubles. Each write owes its mails in the backend's
   own transaction, and the drain after the response is no case of this suite's. */
doubleActionRequest();
// Its drain made a no-op: the mails each write owes leave after a response this suite never sends.
doubleOutbox();
// After the request's own doubles, whose silent logger this one stands in front of: the stream is
// where a token must never reach.
vi.doMock("@/core/config.ts", () => CONFIG_DOUBLE);
vi.doMock("@/core/logging.ts", () => LOGGER_DOUBLE);
const client = doubleApiAnswers(() => Promise.resolve({}));
const writes = client.calls;
/** Answers the write a case presses with `next`. */
const answerWith = (next: () => Promise<unknown>): void => client.answerWith(() => next());
/** The label the backend runs on the application form, off the registry it generated. */
const FORM_LABEL = laufendeFassung("bewerbung").text_version;
// The running label's read answered at its module, so the writes below are the client's whole record:
// `fl_frontend/src/core/einwilligung.test.ts` drives the read itself.
doubleActions({ modules: ["@/core/einwilligung.ts"], answer: () => Promise.resolve(FORM_LABEL) });
const { answerWith: readWith } = doubleActions({ modules: ["@/features/bewerbungen/queries.ts"], answer: () => Promise.resolve(GELESEN) });
const { answerWith: clubsWith } = doubleActions({
  modules: ["@/features/teams/queries.ts"],
  answer: () => Promise.resolve({ teams: [{ id: GEWAEHLT.bewerbung.team_id, name: "Helmholtz" }] }),
});

beforeEach(() => {
  logged.length = 0;
});
const {
  ablehnenBewerbungAction,
  annehmenBewerbungAction,
  besetzeKontaktSitzAction,
  einwilligungErneutSendenAction,
  kontaktEmailKorrigierenAction,
} = await import("./actions.ts");

const ANNEHMEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/annehmen";
const ABLEHNEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/ablehnen";

/** The season's entry rules, which `annehmen_bewerbung` reaches rather than restating, and so the ones an acceptance can answer. */
const REUSED_ENTRY_CODES: Code[] = ["entry_saison_not_future", "entry_gruppe_not_offered", "entry_gruppe_full", "team_retired"];

describe("the triage's refusals against the codes its endpoints publish", () => {
  it("answers every code the acceptance publishes through the triage's mapper", async () => {
    const published = refusalCodes(
      "duplicate_key",
      "bewerbung_already_decided",
      "bewerbung_subject_unresolved",
      "bewerbung_schule_unusable",
      "bewerbung_kontakte_unconfirmed",
      "entry_saison_not_future",
      "entry_gruppe_not_offered",
      "entry_gruppe_full",
      "team_retired",
    );

    for (const code of published) {
      expect(answerShown(code, acceptanceMapped), `${code} is published on the acceptance and reaches the admin unmapped`).not.toBe(null);
    }
    await assertEachAnswered({
      codes: refusalCodes(
        "duplicate_key",
        "bewerbung_already_decided",
        "bewerbung_subject_unresolved",
        "bewerbung_schule_unusable",
        "bewerbung_kontakte_unconfirmed",
        "entry_saison_not_future",
        "entry_gruppe_not_offered",
        "entry_gruppe_full",
        "team_retired",
      ),
      refuseWith: answerWith,
      act: () => annehmenBewerbungAction(ANNAHME),
      mapped: acceptanceMapped,
    });
  });

  it("answers every code the decline publishes through the triage's mapper", async () => {
    const published = refusalCodes("bewerbung_already_decided");

    expect(published).toStrictEqual(["bewerbung_already_decided"]);
    for (const code of published) {
      expect(answerShown(code, declineMapped), `${code} is published on the decline and reaches the admin unmapped`).not.toBe(null);
    }
    await assertEachAnswered({
      codes: refusalCodes("bewerbung_already_decided"),
      refuseWith: answerWith,
      act: () => ablehnenBewerbungAction({ id: BEWERBUNG_ID, grund: "Die Liga ist voll." }),
      mapped: declineMapped,
    });
  });

  /* Asked of the acceptance itself rather than of the entry endpoint: `annehmen_bewerbung` reaches the
     season's entry services, so each of their rules is one an acceptance can be refused on. */
  it("maps the entry rules the acceptance reuses", () => {
    for (const code of REUSED_ENTRY_CODES) {
      expect(acceptanceMapped(refused(code)), `${code} can refuse an acceptance and the mapper does not answer it`).not.toBe(null);
    }
  });

  /* The stored application tells a new school's `uniq_shorthand` collision from a picked club's
     `uniq_saison_id_team_id` one, and each gets the repair its own index asks for. */
  it("answers a new school's duplicate key with the Kürzel repair rather than the generic conflict", async () => {
    answerWith(() => Promise.reject(refused(DUPLICATE_KEY)));

    expect(errorOf(await annehmenBewerbungAction(ANNAHME)), "the collision names no way out of itself").toMatch(/Kürzel des anderen Teams/);
  });

  it("answers a picked club's duplicate key in the club editor's words for a club already in the season", async () => {
    const collision = refused(DUPLICATE_KEY);
    answerWith(() => Promise.reject(collision));
    readWith(() => Promise.resolve(GEWAEHLT));

    const answer = errorOf(await annehmenBewerbungAction(ANNAHME));

    expect(answer, "a club already in the season is sent to change another club's Kürzel").toBe(mapAlreadyEnteredRefusal(collision));
  });

  /* Neither sentence without the application: each tells the admin to repair something that may not be at fault. */
  it("leaves the duplicate key to the shared reader, logging nothing, where the network never answered the application's read", async () => {
    const collision = refused(DUPLICATE_KEY);
    answerWith(() => Promise.reject(collision));
    readWith(() =>
      Promise.reject(
        new APINetworkError({
          message: "Network request failed.",
          url: "http://backend/bewerbungen",
          method: "GET",
          readOnly: true,
          traceId: "c".repeat(32),
          isTimeout: true,
        }),
      ),
    );

    expect(errorOf(await annehmenBewerbungAction(ANNAHME))).toBe(toActionErrorResult(collision).error);
    expect(collisionReadLines()).toStrictEqual([]);
  });

  /* A bug in the read words the refusal as the shared reader does, which only its line tells apart. */
  it("leaves the duplicate key to the shared reader, logging the read's untyped failure", async () => {
    const collision = refused(DUPLICATE_KEY);
    answerWith(() => Promise.reject(collision));
    readWith(() => Promise.reject(new TypeError("Cannot read properties of undefined (reading 'bewerbung')")));

    expect(errorOf(await annehmenBewerbungAction(ANNAHME))).toBe(toActionErrorResult(collision).error);
    expect(collisionReadLines().map((meta) => meta.name)).toStrictEqual(["TypeError"]);
  });

  /* The loop above pins that it is answered, this what it says. Which of the school's fields
     fails never reaches the wire, so the message names the candidates, and no edit path turns the
     application into a shape acceptance takes. */
  it("names the school's own fields, and a repair that exists, when no club can be created", () => {
    const refusal = acceptanceMapped(refused("bewerbung_schule_unusable"))?.error ?? "";

    expect(refusal, "the refusal names no field an administrator could look at").toMatch(
      /Team, vollständiger Name, Kürzel, Adresse oder Website/,
    );
    expect(refusal, "the refusal offers no route the admin surface actually has").toMatch(/Lehne die Bewerbung ab und lege das Team/);
  });

  /* `fl_backend/app/api/bewerbungen/services.py :: find_unconfirmed_kontakte_refusal`'s code. A code the
     mapper misses falls through to the shared fallback, which names no reason. */
  it("answers the acceptance's refusal over an unconfirmed seat", () => {
    expect(acceptanceMapped(refused("bewerbung_kontakte_unconfirmed"))?.error ?? "").toMatch(/Kontaktperson/);
  });
});

/**
 * The application a decision's write answers with: a proposed school, one seat holding a mailbox.
 * Typed as the read model, so a field the read model gains fails here rather than in the answer.
 */
const ENTSCHIEDEN: FLBewerbung = {
  id: BEWERBUNG_ID,
  saison_id: "2026",
  eingereicht_am: "2026-09-01",
  status: "eingereicht",
  team_id: null,
  schule: {
    team_name: "Gymnasium Beispiel",
    full_name: "Gymnasium Beispiel Frankfurt",
    shorthand: "GB",
    schulform: null,
    address: { strasse: "Schulweg", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" },
    website_url: null,
  },
  kontakte: {
    trainer: null,
    ansprechperson: {
      ...PERSON,
      nachname: "Meier",
      telefon: "069 1234567",
      geburtsdatum: null,
      einwilligung: kenntnisnahme({ text_version: FORM_LABEL, datum: "2026-09-01", bestaetigt_am: null }),
    },
    stellvertretung: null,
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "Ein Satz", wunschfarbe: "rot" },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 2 },
  stufengroesse: 96,
  wunschgegner: null,
  entscheidung: null,
  bestaetigungen: {
    trainer: null,
    ansprechperson: { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: null, zustellung: null },
    stellvertretung: null,
  },
  bestaetigungsfrist: "2026-09-15",
};

/** Both decisions, each pressed as its panel presses it and answered, where it lands, with `document`. */
const DECISIONS = [
  {
    where: "the acceptance",
    betreff: "Zusage",
    operation: ANNEHMEN_OPERATION,
    landed: (document: object) => ({
      saison_id: "2026",
      gruppe: "A",
      trikot_farbe: null,
      created_team: true,
      team_id: GEWAEHLT.bewerbung.team_id,
      id: (document as { id: string }).id,
    }),
    press: () => annehmenBewerbungAction(ANNAHME),
  },
  {
    where: "the decline",
    betreff: "Absage",
    operation: ABLEHNEN_OPERATION,
    landed: (document: object) => ({ id: (document as { id: string }).id }),
    press: () => ablehnenBewerbungAction({ id: BEWERBUNG_ID, grund: "Die Liga ist voll." }),
  },
] as const;

/** Each repair's payload, as its control sends it for the Ansprechperson's seat. */
const ERNEUT = { id: BEWERBUNG_ID, rolle: "ansprechperson" } as const;
const KORREKTUR = { id: BEWERBUNG_ID, rolle: "ansprechperson", email: "anna.neu@example.de", bisherige_email: PERSON.email } as const;
const SITZ = {
  id: BEWERBUNG_ID,
  rolle: "ansprechperson",
  vorname: "Berta",
  nachname: "Beispiel",
  email: "berta@example.de",
  telefon: "069 1234567",
  text_version: FORM_LABEL,
} as const;

/** The paths of the three repairs above, each a write that mints the seat's link and so spends the one it held. */
const ERNEUT_PATH = `/bewerbungen/${BEWERBUNG_ID}/einwilligung/ansprechperson/erneut`;
const KORREKTUR_PATH = `/bewerbungen/${BEWERBUNG_ID}/kontakte/ansprechperson/email`;
const SITZ_PATH = `/bewerbungen/${BEWERBUNG_ID}/kontakte/ansprechperson`;

/** The application read as the page drew it, with the deadline a seat's link stood under before any repair. */
const VOR_DER_REPARATUR = { bewerbung: { ...GELESEN.bewerbung, bestaetigungsfrist: "2026-09-01" } };

/** The re-send's answer to each state it cannot compose a message from. */
async function unsendableAnswers(): Promise<Record<"weg" | "leer" | "ohneAdresse" | "ohneTeam", string>> {
  const pressOn = async (gelesen: unknown): Promise<string> => {
    readWith(() => Promise.resolve(gelesen));
    return errorOf(await einwilligungErneutSendenAction(ERNEUT));
  };

  return {
    weg: await pressOn(null),
    leer: await pressOn({ bewerbung: { ...GELESEN.bewerbung, kontakte: { ansprechperson: null } } }),
    ohneAdresse: await pressOn({ bewerbung: { ...GELESEN.bewerbung, kontakte: { ansprechperson: { ...PERSON, email: "" } } } }),
    ohneTeam: await pressOn({ bewerbung: { ...GELESEN.bewerbung, schule: null, team_id: null } }),
  };
}

/** What the re-send's write answers where it lands, for the seat and the mailbox it matched. */
const erneutGeschrieben = (overrides: object = {}) => ({
  rolle: "ansprechperson",
  email: PERSON.email,
  rollen: ["ansprechperson"],
  bestaetigungsfrist: "2026-09-18",
  ...overrides,
});

/** What the correction's write answers where it lands. */
const korrigiert = () => ({
  email: KORREKTUR.email,
  rollen: ["ansprechperson"],
  bestaetigungsfrist: "2026-09-18",
});

/** What the reseat's write answers where it lands, for the seats it filled and the address as it stored it. */
const besetzt = (rollen: readonly string[] = ["ansprechperson"]) => ({
  email: SITZ.email,
  rollen: rollen,
  bestaetigungsfrist: "2026-09-18",
});

/** A success's report, or the refusal's sentence where the action failed. */
const answerOf = (result: { success: boolean; message?: string; error?: string }): string => result.message ?? result.error ?? "";

describe("the application's writes", () => {
  it("reach each published path and method, the id and the seat in the path and the fields alone in the body", async () => {
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    for (const { press, landed } of DECISIONS) {
      answerWith(() => Promise.resolve(landed(ENTSCHIEDEN)));
      await press();
    }
    answerWith(() => Promise.resolve(erneutGeschrieben()));
    await einwilligungErneutSendenAction(ERNEUT);
    answerWith(() => Promise.resolve(korrigiert()));
    await kontaktEmailKorrigierenAction(KORREKTUR);
    answerWith(() => Promise.resolve(besetzt()));
    await besetzeKontaktSitzAction(SITZ);

    const bewerbung = `/bewerbungen/${BEWERBUNG_ID}`;
    const { id: _id, rolle: _rolle, ...person } = SITZ;
    // The writes alone: each owes its mails in the backend's own transaction, so no report of a send follows one.
    expect(requestsOf(writes)).toStrictEqual([
      { endpoint: `${bewerbung}/annehmen`, method: "POST", body: { gruppe: ANNAHME.gruppe, trikot_farbe: ANNAHME.trikot_farbe } },
      { endpoint: `${bewerbung}/ablehnen`, method: "POST", body: { grund: "Die Liga ist voll." } },
      { endpoint: `${bewerbung}/einwilligung/ansprechperson/erneut`, method: "POST", body: undefined },
      // The address the page showed rides beside the corrected one: the backend judges the seat's holder by it.
      {
        endpoint: `${bewerbung}/kontakte/ansprechperson/email`,
        method: "POST",
        body: { email: KORREKTUR.email, bisherige_email: PERSON.email },
      },
      { endpoint: `${bewerbung}/kontakte/ansprechperson`, method: "POST", body: person },
    ]);
  });
});

describe("what a decision says of its mails", () => {
  /* The decision is committed with its mails owed in the same write, so the answer states it as taken and names who
     the mail goes to, never whether it arrived. */
  it("reports the decision as taken, its mail owed every contact person", async () => {
    for (const { where, betreff, landed, press } of DECISIONS) {
      answerWith(() => Promise.resolve(landed(ENTSCHIEDEN)));

      const result = await press();

      expect(result.success, `${where} did not land`).toBe(true);
      assert.ok(answerOf(result).endsWith(`Die ${betreff} geht an jede Kontaktperson.`), `${where} names no mail: ${answerOf(result)}`);
    }
  });

  it("owes nothing where the API write is refused", async () => {
    for (const { where, press } of DECISIONS) {
      answerWith(() => Promise.reject(refused("bewerbung_already_decided")));

      expect((await press()).success, `${where} reports a refused decision as taken`).toBe(false);
    }
  });
});

/** Where one surface's German comes from: what it rendered, split into its sentences. */
type RenderingSource = { where: string; rendered: readonly string[] };

/**
 * Every rendering of one refusal code. Read across the surfaces rather than out of one: what a code
 * means is the backend's, and two surfaces naming that meaning differently is what this looks for.
 */
function renderingsOf(sources: readonly RenderingSource[]): { where: string; german: string; sentences: string[] }[] {
  return sources.map((source) => ({ where: source.where, german: source.rendered.join(" "), sentences: [...source.rendered] }));
}

/**
 * What one mapper renders for one code, one sentence per entry: a banner's reason and its repair,
 * or a field's message. Nothing where the mapper leaves the code, which the counts below then catch.
 */
function renderedBy(where: string, answer: string | { error?: string; fieldErrors?: Record<string, string> } | null): RenderingSource[] {
  if (answer === null) return [];
  const texts = typeof answer === "string" ? [answer] : [answer.error ?? "", ...Object.values(answer.fieldErrors ?? {})];

  return [{ where: where, rendered: texts.flatMap((text) => text.split(/(?<=\.)\s+/)).filter((sentence) => sentence !== "") }];
}

/**
 * The season panel's own answer to the same stored state, built rather than read: which of its three
 * bodies stands is picked from `saisonStatus`, and no branch of it names the server's code.
 */
const retiredBannerOn = (saisonStatus: TeamSaisonMembership["saisonStatus"]): RenderingSource[] => {
  const banner = buildTeamBanners({
    isRetired: true,
    saisonId: "2026",
    saisonStatus: saisonStatus,
    isMember: false,
    storedAustritt: null,
    hasAustritt: false,
    draftGrund: "",
    isGruppeLocked: false,
    isGruppeChanged: false,
  }).find(({ id }) => id === "team.not-in-saison-retired");

  // Dropped rather than rendered empty: a banner the panel stopped raising is what the count above
  // catches, and an empty string would satisfy every case below without carrying a word.
  if (banner === undefined) return [];

  // Both halves: the title carries the season and the noun, the body the state word and the repair.
  const rendered = [banner.title, banner.body ?? ""].filter((line) => line !== "");

  return [{ where: `the banner on a ${saisonStatus} season`, rendered: rendered }];
};

/**
 * Named against the union, so a status renamed out of it fails here rather than quietly dropping a
 * rendering. A status ADDED to it is caught by neither this nor the count, and stays review's.
 */
const SAISON_STATUSES = ["future", "active", "past"] as const satisfies readonly TeamSaisonMembership["saisonStatus"][];

const RETIRED_RENDERINGS = renderingsOf([
  ...renderedBy("the triage", mapTriageRefusal(refused("team_retired"), "bestehendes_team")),
  ...renderedBy("the club editor's entry", mapEntryRefusal(refused("team_retired"))),
  ...renderedBy("the team create's entry", mapCreatedClubEntryRefusal(refused("team_retired"))),
  ...renderedBy("the club editor's replacement", mapReplacementRefusal(refused("team_retired"))),
  ...SAISON_STATUSES.flatMap(retiredBannerOn),
]);

/** Every determiner a neuter noun takes. One in front of „Team“ that is not here is the disagreement. */
const NEUTER_ARTICLES = ["Das", "das", "Dieses", "dieses", "Ein", "ein", "Kein", "kein", "Sein", "sein", "Jedes", "jedes"];

/**
 * Masculine, because that is the wrong guess „Team“ invites: „Verein“ and „Club“ are masculine and
 * carry the same meaning. Feminine is left out — „Bewerbung“ and „Saison“ stand in these sentences too.
 */
const NOT_A_TEAM = /(?<!\p{L})(ihn|ihm|er)(?!\p{L})/gu;

/**
 * The words ending in `-st` that address nobody. Every other one is a second-person indicative, and a
 * repair is written as an imperative.
 */
const NOT_AN_INDICATIVE = ["ist", "lässt", "erst", "selbst", "sonst", "zunächst", "fast", "meist", "Frist", "Rest"];

/**
 * What „Reaktiviere“ takes as its object: the neuter pronoun, or „Team“ under the determiner and any
 * adjective agreeing with it. A sentence naming the club inside the imperative reaches no pronoun.
 */
const REACTIVATED_OBJECT = new RegExp(`^(?:es|(?:${NEUTER_ARTICLES.join("|")})(?:\\s+\\p{L}+)?\\s+Team)\\b`, "u");

/**
 * The agreement „Team“ forces and the imperative a repair is written in, over one rendering. Neither
 * is greppable: the word that has to agree sits a clause after the noun, or in the next sentence.
 */
function assertTheGermanAgrees(where: string, sentences: readonly string[]): void {
  for (const sentence of sentences) {
    // Both words before the noun, and one of them carrying the agreement: which of the two is the
    // determiner and which the adjective is not decidable by position — „nimm das Team“ reads alike.
    for (const [, ...before] of sentence.matchAll(/(?:(\p{L}+)\s+)?(\p{L}+)\s+Team(?![-\p{L}])/gu)) {
      const words = before.filter((word) => word !== undefined);

      assert.ok(
        words.some((word) => NEUTER_ARTICLES.includes(word)),
        `${where} puts „${words.join(" ")}“ in front of the neuter „Team“`,
      );
    }

    for (const [, object] of sentence.matchAll(/Reaktiviere\s+([^.,;]+)/gu)) {
      expect(object!, `${where} reactivates „${object!}“, which does not agree with the neuter „Team“`).toMatch(REACTIVATED_OBJECT);
    }

    for (const [pronoun] of sentence.matchAll(NOT_A_TEAM)) {
      assert.fail(`${where} stands „${pronoun}“ in for a „Team“, which is neuter`);
    }

    for (const [word] of sentence.matchAll(/(?<!\p{L})(\p{L}+st)(?!\p{L})/gu)) {
      assert.ok(NOT_AN_INDICATIVE.includes(word), `${where} says „${word}“ where a repair addresses the reader as an imperative`);
    }
  }
}

describe("the German one refusal code is given", () => {
  /* First: a cut that stopped matching, or a banner that stopped being raised, leaves nothing for the
     cases below to read, and no sentence carries a banned word, so each would pass over nothing. */
  it("finds every rendering of the retired-club refusal before judging one", () => {
    expect(
      RETIRED_RENDERINGS.length,
      `team_retired is rendered in ${String(RETIRED_RENDERINGS.length)} places, not the seven this case reads`,
    ).toBe(7);
    for (const { where, sentences } of RETIRED_RENDERINGS) {
      expect(sentences.length, `${where} holds no rendered sentence`).not.toBe(0);
    }
  });

  /* `team_retired` is `inactive_since`, whose verb pair `docs/glossary.md :: inactive_since` fixes:
     _stilllegen_ retires the club across the league, _austragen_ takes one squad row out of one
     season. „Verlassen“ is an `austritt`, a third record on a third page. */
  it("calls a retired club stillgelegt in every branch that answers it", () => {
    for (const { where, german } of RETIRED_RENDERINGS) {
      assert.ok(german.includes("stillgelegt"), `${where} gives team_retired a state word other than „stillgelegt“`);
      expect(german, `${where} names the club as something other than a „Team“`).toMatch(/\bTeam\b/);

      for (const banned of ["usgeschieden", "usgetragen", "verlassen", "Verein"]) {
        assert.ok(!german.includes(banned), `${where} says „${banned}“ of a retired club, which is another record entirely`);
      }
    }
  });

  /* The vocabulary above holds while the grammar drifts. „Team“ is neuter, and what agrees with it
     is a pronoun a clause later, which no grep for the noun finds. „Reaktiviere ihn“ and the
     indicative „nimmst“ pass every case above. */
  it("keeps the agreement a neuter Team forces, and the imperative a repair is written in", () => {
    for (const { where, sentences } of RETIRED_RENDERINGS) assertTheGermanAgrees(where, sentences);
  });
});

/**
 * The entry rules an acceptance and the club editor both answer. `entry_gruppe_locked` is not among them:
 * it guards a group MOVE, which no acceptance performs.
 */
const SHARED_ENTRY_CODES: Code[] = ["entry_saison_not_future", "entry_gruppe_not_offered", "entry_gruppe_full"];

const ENTRY_RENDERINGS = SHARED_ENTRY_CODES.map((code) => ({
  code: code,
  renderings: renderingsOf([
    ...renderedBy("the triage", acceptanceMapped(refused(code))),
    ...renderedBy("the club editor", mapEntryRefusal(refused(code))),
  ]),
}));

describe("the sentence both entry surfaces render for one code", () => {
  for (const { code, renderings } of ENTRY_RENDERINGS) {
    /* The opening sentence and not the whole message: a repair names a control, and the two surfaces
       have different ones — the triage declines an application, the club editor picks a season. */
    it(`opens ${code} with one sentence, spelled the same on both`, () => {
      // Before the comparison: a cut that stopped matching leaves one side empty, and two empty
      // sides are equal.
      expect(renderings.length, `${code} is rendered in ${String(renderings.length)} places, not the two this case reads`).toBe(2);
      for (const { where, sentences } of renderings) {
        expect(sentences.length, `${where} was cut to something holding no rendered sentence for ${code}`).not.toBe(0);
      }

      const [first, second] = renderings;

      expect(second?.sentences[0], `the two surfaces open ${code} with different sentences`).toBe(first?.sentences[0]);
    });
  }

  /* Equality above leaves the repair unread, and a repair is the half each surface writes alone. */
  it("keeps the agreement and the imperative in every entry refusal, repair included", () => {
    for (const { renderings } of ENTRY_RENDERINGS) {
      for (const { where, sentences } of renderings) assertTheGermanAgrees(where, sentences);
    }
  });
});

describe("the decline's bound", () => {
  /* A decline is stored on the application and mailed to the school in one irreversible step, so
     „   “ has to be refused as the empty reason it is. The backend's `min_length` does not strip, and
     the browser is where the value still can be. */
  it("refuses a reason that is only whitespace, and carries the trimmed one", () => {
    const parsed = FLAblehnenBewerbungPayloadSchema.safeParse({ id: "68d0f2a4c1e2b3a4d5e6f708", grund: "   " });

    expect(parsed.success, "a whitespace-only reason parses, and would be stored and mailed as one").toBe(false);
    expect(
      FLAblehnenBewerbungPayloadSchema.safeParse({ id: "68d0f2a4c1e2b3a4d5e6f708", grund: "  Kein Platz.  " }).data?.grund,
      "the reason reaches the write with the padding the administrator typed around it",
    ).toBe("Kein Platz.");
  });

  /* A reason at the cap with padding around it: the schema takes it, so the panel that measures the
     raw string disables the button and counts past the cap over a reason the school would have read. */
  it("takes a reason whose padding is all that carries it past the cap", () => {
    const padded = `  ${"a".repeat(BEWERBUNG_GRUND_MAX_LENGTH)}  `;
    const parsed = FLAblehnenBewerbungPayloadSchema.safeParse({ id: "68d0f2a4c1e2b3a4d5e6f708", grund: padded });

    expect(parsed.success, "a reason inside the cap once trimmed is refused by the schema").toBe(true);
    expect(parsed.data?.grund.length).toBe(BEWERBUNG_GRUND_MAX_LENGTH);
  });
});

describe("the pills the queue's card wears", () => {
  /* A pill that cannot break overruns the cell it sits in instead of wrapping inside it, and a
     card's own grid track is where one gets narrow enough to break. */
  it("never lets a pill break across two lines", () => {
    expect(labelBadge("info"), "a pill breaks across two lines, where it reads as two pills").toMatch(/\bwhitespace-nowrap\b/);
  });
});

describe("a repair whose link's mail cannot be composed", () => {
  it("lets the club read that precedes a mint throw, before any link is spent", async () => {
    readWith(() => Promise.resolve(GEWAEHLT));
    clubsWith(() => Promise.reject(new Error("the club list answered nothing")));

    for (const [where, press, mint] of [
      ["the re-send", () => einwilligungErneutSendenAction(ERNEUT), ERNEUT_PATH],
      ["the correction", () => kontaktEmailKorrigierenAction(KORREKTUR), KORREKTUR_PATH],
      ["the reseat", () => besetzeKontaktSitzAction(SITZ), SITZ_PATH],
    ] as const) {
      const result = await press();

      expect(result.success, `${where} answered as though the club read had not failed`).toBe(false);
      expect(
        requestsOf(writes).filter(({ endpoint }) => endpoint === mint),
        `${where} spent the seat's link before a club read that could not compose its message`,
      ).toStrictEqual([]);
    }
  });
});

describe("the re-sent confirmation link", () => {
  /* The button carries no address box, so the repairs' „Trage eine andere Adresse ein“ would name a
     field that is not there: the sentence names the correction control beside it instead. */
  it("words a barred address with the control the administrator can use from the button", () => {
    const answered = mapEinwilligungErneutRefusal(refused("bewerbung_kontakt_gesperrt", 409));

    assert.ok(String(answered).includes(`„${ADRESSE_KORRIGIEREN}“`), "the sentence names a control the strip does not label so");
    expect(String(answered)).not.toMatch(/Trage eine andere Adresse ein/);
  });

  it("answers every code the re-send publishes through its own mapper", async () => {
    for (const code of refusalCodes("bewerbung_already_decided", "bewerbung_sitz_already_answered", "bewerbung_kontakt_gesperrt")) {
      expect(answerShown(code, mapEinwilligungErneutRefusal), `${code} is published on the re-send and reaches the admin unmapped`).not.toBe(
        null,
      );
    }
    await assertEachAnswered({
      codes: refusalCodes("bewerbung_already_decided", "bewerbung_sitz_already_answered", "bewerbung_kontakt_gesperrt"),
      refuseWith: answerWith,
      act: () => einwilligungErneutSendenAction({ id: BEWERBUNG_ID, rolle: "ansprechperson" }),
      mapped: mapEinwilligungErneutRefusal,
    });
  });

  /* The write answers the address it owed the link at, and only the write knows it: a correction landing between the
     page's read and the press moves the mailbox, and the API stores the fold of what was typed. */
  it("names the address each repair's write answered, never the read's nor the typed one", async () => {
    for (const [where, press, answer, to] of [
      ["the re-send", () => einwilligungErneutSendenAction(ERNEUT), erneutGeschrieben({ email: "anna.neu@example.de" }), "anna.neu@example.de"],
      ["the correction", () => kontaktEmailKorrigierenAction({ ...KORREKTUR, email: "Anna.Neu@Example.de" }), korrigiert(), KORREKTUR.email],
      ["the reseat", () => besetzeKontaktSitzAction({ ...SITZ, email: "Berta@Example.de" }), besetzt(), SITZ.email],
    ] as const) {
      readWith(() => Promise.resolve(VOR_DER_REPARATUR));
      answerWith(() => Promise.resolve(answer));

      const result = await press();

      expect(result.success, `${where} did not land`).toBe(true);
      expect(answerOf(result), `${where} names another address`).toBe(`Der neue Link geht an ${to}.`);
    }
  });

  /* Judged before the mint, because `compose_erneut_update` replaces the seat's entry whole: a press
     that could never compose a message would otherwise void the link that seat is holding. */
  it("refuses what it could not send before it spends the seat's link", async () => {
    const answers = await unsendableAnswers();

    expect(answers.weg).toMatch(/Diese Bewerbung gibt es nicht mehr/);
    expect(answers.leer).toMatch(/Für diese Rolle steht niemand mehr in der Bewerbung/);
    expect(answers.ohneAdresse).toBe(ERNEUT_OHNE_ADRESSE);
    expect(answers.ohneTeam).toMatch(/Diese Bewerbung nennt kein Team/);
    expect(writes, "the re-send spent the seat's link on a press that could never compose its message").toStrictEqual([]);
  });

  /* One sentence for four states told an administrator the seat had no address where the application
     named no club at all, and the repair each of them offers is a different one. */
  it("gives each of those states a sentence of its own", async () => {
    // Punctuation dropped: a refusal built from a reason and a repair carries the stops `buildRefusal`
    // writes, and comparing them would call two identical answers different.
    const comparable = (satz: string): string =>
      satz
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

    const unsendable = Object.values(await unsendableAnswers());
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(erneutGeschrieben()));
    const landed = answerOf(await einwilligungErneutSendenAction(ERNEUT));

    const saetze = [...unsendable, landed].map(comparable);

    assert.ok(
      saetze.every((satz) => satz !== ""),
      `a re-send answered with no sentence at all: ${saetze.join(" | ")}`,
    );
    expect(new Set(saetze).size, "two of the re-send's answers say the same thing").toBe(saetze.length);
  });
});

describe("the corrected contact address", () => {
  it("answers every code the correction publishes through its own mapper", async () => {
    for (const code of refusalCodes(
      "bewerbung_already_decided",
      "bewerbung_sitz_already_answered",
      "bewerbung_kontakt_email_taken",
      "bewerbung_kontakt_gesperrt",
      "bewerbung_sitz_anders_besetzt",
    )) {
      expect(answerShown(code, mapKontaktEmailRefusal), `${code} is published on the correction and reaches the admin unmapped`).not.toBe(null);
    }
    await assertEachAnswered({
      codes: refusalCodes(
        "bewerbung_already_decided",
        "bewerbung_sitz_already_answered",
        "bewerbung_kontakt_email_taken",
        "bewerbung_kontakt_gesperrt",
        "bewerbung_sitz_anders_besetzt",
      ),
      refuseWith: answerWith,
      act: () => kontaktEmailKorrigierenAction(KORREKTUR),
      mapped: mapKontaktEmailRefusal,
    });
  });
});

describe("the person seated where one stepped out", () => {
  it("answers every code the reseat publishes through its own mapper", async () => {
    for (const code of refusalCodes(
      "bewerbung_already_decided",
      "bewerbung_sitz_already_answered",
      "bewerbung_kontakt_email_taken",
      "bewerbung_kontakt_gesperrt",
      "fassung_unzulaessig",
    )) {
      expect(answerShown(code, mapKontaktSitzRefusal), `${code} is published on the reseat and reaches the admin unmapped`).not.toBe(null);
    }
    await assertEachAnswered({
      codes: refusalCodes(
        "bewerbung_already_decided",
        "bewerbung_sitz_already_answered",
        "bewerbung_kontakt_email_taken",
        "bewerbung_kontakt_gesperrt",
        "fassung_unzulaessig",
      ),
      refuseWith: answerWith,
      act: () =>
        besetzeKontaktSitzAction({
          id: BEWERBUNG_ID,
          rolle: "ansprechperson",
          vorname: "Berta",
          nachname: "Beispiel",
          email: "berta@example.de",
          telefon: "069 1234567",
          text_version: FORM_LABEL,
        }),
      mapped: mapKontaktSitzRefusal,
    });
  });

  /* `SITZ_LEER` is the correction's guard on an empty slot, and an empty slot is what this write runs
     ON: copied here it would refuse every press the control is offered for. */
  it("judges no empty seat of its own, that being its entry condition", async () => {
    readWith(() => Promise.resolve({ bewerbung: { ...VOR_DER_REPARATUR.bewerbung, kontakte: { ansprechperson: null } } }));
    answerWith(() => Promise.resolve(besetzt()));

    const result = await besetzeKontaktSitzAction(SITZ);

    expect(result.success, `the reseat refuses the seat state it exists to repair: ${answerOf(result)}`).toBe(true);
    assert.ok(
      requestsOf(writes).some(({ endpoint }) => endpoint === SITZ_PATH),
      "the reseat never reached its write",
    );
  });

  it("still refuses what it cannot compose a message from, before it seats anybody", async () => {
    readWith(() => Promise.resolve(null));
    expect(errorOf(await besetzeKontaktSitzAction(SITZ))).toMatch(/Diese Bewerbung gibt es nicht mehr/);

    readWith(() => Promise.resolve({ bewerbung: { ...VOR_DER_REPARATUR.bewerbung, schule: null, team_id: null } }));
    expect(errorOf(await besetzeKontaktSitzAction(SITZ))).toMatch(/Diese Bewerbung nennt kein Team/);

    expect(writes, "the reseat seated a person behind a message nobody could compose").toStrictEqual([]);
  });
});
