import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, it } from "node:test";

import { LIGA_KENNTNISNAHME } from "@/core/einwilligung.ts";
import { cacheCalls, doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";
import { formatSpielDatum } from "@/shared/utils/format.ts";

import { labelBadge } from "../../shared/components/ui/badges.ts";
import { buildTeamBanners } from "../teams/components/forms/AdminTeamEditForm/banners.ts";
import { mapAlreadyEnteredRefusal, mapEntryRefusal, mapReplacementRefusal } from "../teams/refusals.ts";
import { bestaetigungsLink } from "./bestaetigungLink.ts";
import { BEWERBUNG_GRUND_MAX_LENGTH, ERNEUT_OHNE_ADRESSE } from "./constants.ts";
import { mapEinwilligungErneutRefusal, mapKontaktEmailRefusal, mapKontaktSitzRefusal, mapTriageRefusal } from "./refusals.ts";
import { FLAblehnenBewerbungPayloadSchema } from "./schemas.ts";

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
const mailed: { to: string; text: string }[] = [];
/** Every argument each logger call was handed, whatever its level. */
const logged: unknown[][] = [];
const recorders = globalThis as unknown as Record<string, unknown>;
recorders.__flBewerbungMailed = mailed;
recorders.__flBewerbungLogged = logged;
registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/core/config.ts")) {
      return { format: "module", source: `export const frontend_config = { AUTH_URL: "${ORIGIN}" };`, shortCircuit: true };
    }
    if (url.endsWith("/src/core/mail.ts")) {
      // A mailbox refusing the message is what a case sets `__flBewerbungMailRefused` for.
      const source = `export class MailWithheldError extends Error {}
export class MailRecipientError extends Error {}
export const sendMail = async (mail) => {
  if (globalThis.__flBewerbungMailRefused) throw new MailRecipientError("the mailbox refused the message");
  globalThis.__flBewerbungMailed.push({ to: mail.to, text: mail.text });
  return { id: "msg-1" };
};`;
      return { format: "module", source, shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

/* The real actions, called: the request they run in, the application three of them read first,
   the club list and the writes they send are the doubles. */
doubleActionRequest();
// After the request's own doubles, whose silent logger this one stands in front of: the stream is
// where a token must never reach.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith("/src/core/logging.ts")) return nextLoad(url, context);
    const source = `const record = (...args) => void globalThis.__flBewerbungLogged.push(args);
export const logger = { debug: record, info: record, warn: record, error: record };`;
    return { format: "module", source, shortCircuit: true };
  },
});
const { answerWith, calls: writes } = doubleActions({ modules: ["/src/features/bewerbungen/mutations.ts"] });
const { answerWith: readWith } = doubleActions({ modules: ["/src/features/bewerbungen/queries.ts"], answer: () => Promise.resolve(GELESEN) });
const { answerWith: clubsWith } = doubleActions({
  modules: ["/src/features/teams/queries.ts"],
  answer: () => Promise.resolve({ teams: [{ id: GEWAEHLT.bewerbung.team_id, name: "Helmholtz" }] }),
});

/* Each case starts with nothing mailed, logged or written, and with every mailbox taking the message. */
beforeEach(() => {
  mailed.length = 0;
  logged.length = 0;
  writes.length = 0;
  recorders.__flBewerbungMailRefused = false;
});
const {
  ablehnenBewerbungAction,
  annehmenBewerbungAction,
  besetzeKontaktSitzAction,
  einwilligungErneutSendenAction,
  kontaktEmailKorrigierenAction,
} = await import("./actions.ts");
/* After the doubles, as the actions are: a static import would load the real mail module first. */
const { rollenText } = await import("./notifications.ts");

const ANNEHMEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/annehmen";
const ABLEHNEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/ablehnen";
const ERNEUT_OPERATION = "POST /bewerbungen/{bewerbung_id}/einwilligung/{seat}/erneut";
/** Where the entry rules acceptance REUSES are declared: they belong to the season's boundary, not the triage's. */
const ENTRY_OPERATION = "POST /teams/{team_id}/saisons";

/** The season's entry rules, which `annehmen_bewerbung` reaches rather than restating, and so the ones an acceptance can answer. */
const REUSED_ENTRY_CODES = ["REQ-ENTER-001", "REQ-ENTER-002", "REQ-ENTER-003", "REQ-ENTER-005"];

/** The one field of a submitted application an administrator may move, in the backend's own spelling. */
const KORREKTUR_OPERATION = "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}/email";

/** The one path that writes a whole person onto a submitted application, in the backend's own spelling. */
const SITZ_OPERATION = "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}";

describe("the triage's refusals against the codes its endpoints publish", () => {
  it("answers every code the acceptance publishes through the triage's mapper", async () => {
    const published = publishedRefusals(ANNEHMEN_OPERATION);

    // A floor rather than the exact set: the backend grows an operation onto a rule whenever an
    // endpoint starts reusing it, and what harms an admin is a published code nobody maps.
    for (const code of ["REQ-BEWERBUNG-001", "REQ-BEWERBUNG-002"]) {
      assert.ok(published.includes(code), `${code} is no longer published on the acceptance`);
    }
    for (const code of published) {
      assert.notEqual(
        answerShown(ANNEHMEN_OPERATION, code, acceptanceMapped),
        null,
        `${code} is published on the acceptance and reaches the admin unmapped`,
      );
    }
    await assertEachAnswered({
      operation: ANNEHMEN_OPERATION,
      refuseWith: answerWith,
      act: () => annehmenBewerbungAction(ANNAHME),
      mapped: acceptanceMapped,
    });
  });

  it("answers every code the decline publishes through the triage's mapper", async () => {
    const published = publishedRefusals(ABLEHNEN_OPERATION);

    assert.deepEqual(
      published.filter((code) => code !== DUPLICATE_KEY),
      ["REQ-BEWERBUNG-001"],
    );
    for (const code of published) {
      assert.notEqual(
        answerShown(ABLEHNEN_OPERATION, code, declineMapped),
        null,
        `${code} is published on the decline and reaches the admin unmapped`,
      );
    }
    await assertEachAnswered({
      operation: ABLEHNEN_OPERATION,
      refuseWith: answerWith,
      act: () => ablehnenBewerbungAction({ id: BEWERBUNG_ID, grund: "Die Liga ist voll." }),
      mapped: declineMapped,
    });
  });

  /* Asked of the acceptance itself rather than of the entry endpoint: `annehmen_bewerbung` reaches the
     season's entry services, so each of their rules is one an acceptance can be refused on. */
  it("maps the entry rules the acceptance reuses", () => {
    const published = publishedRefusals(ANNEHMEN_OPERATION);

    for (const code of REUSED_ENTRY_CODES) {
      assert.ok(published.includes(code), `${code} is no longer published on the acceptance`);
      assert.notEqual(
        acceptanceMapped(refusedOn(ANNEHMEN_OPERATION, code)),
        null,
        `${code} can refuse an acceptance and the mapper does not answer it`,
      );
    }
  });

  /* The stored application tells a new school's `uniq_shorthand` collision from a picked club's
     `uniq_saison_id_team_id` one, and each gets the repair its own index asks for. */
  it("answers a new school's duplicate key with the Kürzel repair rather than the generic conflict", async () => {
    assert.ok(publishedRefusals(ANNEHMEN_OPERATION).includes(DUPLICATE_KEY), "a duplicate key is no longer published on the acceptance");
    answerWith(() => Promise.reject(refusedOn(ANNEHMEN_OPERATION, DUPLICATE_KEY)));

    assert.match(errorOf(await annehmenBewerbungAction(ANNAHME)), /Kürzel des anderen Teams/, "the collision names no way out of itself");
  });

  it("answers a picked club's duplicate key in the club editor's words for a club already in the season", async () => {
    const collision = refusedOn(ANNEHMEN_OPERATION, DUPLICATE_KEY);
    answerWith(() => Promise.reject(collision));
    readWith(() => Promise.resolve(GEWAEHLT));

    const answer = errorOf(await annehmenBewerbungAction(ANNAHME));

    assert.equal(answer, mapAlreadyEnteredRefusal(collision), "a club already in the season is sent to change another club's Kürzel");
  });

  /* Neither sentence without the application: each tells the admin to repair something that may not be at fault. */
  it("leaves the duplicate key to the shared reader where the application cannot be read", async () => {
    const collision = refusedOn(ANNEHMEN_OPERATION, DUPLICATE_KEY);
    answerWith(() => Promise.reject(collision));
    readWith(() => Promise.reject(new Error("the read failed")));

    assert.equal(errorOf(await annehmenBewerbungAction(ANNAHME)), toActionErrorResult(collision).error);
  });

  /* The loop above pins that it is answered, this what it says. Which of the school's fields
     fails never reaches the wire, so the message names the candidates, and no edit path turns the
     application into a shape acceptance takes. */
  it("names the school's own fields, and a repair that exists, when no club can be created", () => {
    const refusal = acceptanceMapped(refusedOn(ANNEHMEN_OPERATION, "REQ-BEWERBUNG-003"))?.error ?? "";

    assert.match(
      refusal,
      /Team, vollständiger Name, Kürzel, Adresse oder Website/,
      "the refusal names no field an administrator could look at",
    );
    assert.match(refusal, /Lehne die Bewerbung ab und lege das Team/, "the refusal offers no route the admin surface actually has");
  });

  /* `fl_backend/app/api/bewerbungen/services.py :: find_unconfirmed_kontakte_refusal`'s code. A code the
     mapper misses falls through to the shared fallback (`.claude/rules/cross-surface.md`). */
  it("answers the acceptance's refusal over an unconfirmed seat", () => {
    assert.ok(
      publishedRefusals(ANNEHMEN_OPERATION).includes("REQ-BEWERBUNG-013"),
      "the unconfirmed seat's rule is no longer published on the acceptance",
    );
    assert.match(acceptanceMapped(refusedOn(ANNEHMEN_OPERATION, "REQ-BEWERBUNG-013"))?.error ?? "", /Kontaktperson/);
  });

  /* `REQ-ENTER-004` guards a group MOVE, which no acceptance performs: a row is created here, never
     moved. Reaching it from this action would refuse an acceptance over fixtures it does not touch. */
  it("leaves the group move's own refusal on the move", () => {
    assert.ok(!publishedRefusals(ANNEHMEN_OPERATION).includes("REQ-ENTER-004"), "the document moved the lock onto the acceptance");
  });
});

/** The application a decision's write answers with: a proposed school, one seat holding a mailbox. */
const ENTSCHIEDEN = {
  saison_id: "2026",
  schule: { team_name: "Gymnasium Beispiel" },
  team_id: null,
  wunschgegner: null,
  kontakte: { trainer: null, ansprechperson: PERSON, stellvertretung: null },
};

/** Both decisions, each pressed as its panel presses it and answered, where it lands, with `document`. */
const DECISIONS = [
  {
    where: "the acceptance",
    betreff: "Zusage",
    operation: ANNEHMEN_OPERATION,
    landed: (document: object) => ({
      acknowledged: 1,
      saison_id: "2026",
      gruppe: "A",
      trikot_farbe: null,
      created_team: true,
      team_id: GEWAEHLT.bewerbung.team_id,
      updated_document: document,
    }),
    press: () => annehmenBewerbungAction(ANNAHME),
  },
  {
    where: "the decline",
    betreff: "Absage",
    operation: ABLEHNEN_OPERATION,
    landed: (document: object) => ({ acknowledged: 1, updated_document: document }),
    press: () => ablehnenBewerbungAction({ id: BEWERBUNG_ID, grund: "Die Liga ist voll." }),
  },
] as const;

/** Each repair's payload, as its control sends it for the Ansprechperson's seat. */
const ERNEUT = { id: BEWERBUNG_ID, rolle: "ansprechperson" } as const;
const KORREKTUR = { id: BEWERBUNG_ID, rolle: "ansprechperson", email: "anna.neu@example.de" } as const;
const SITZ = {
  id: BEWERBUNG_ID,
  rolle: "ansprechperson",
  vorname: "Berta",
  nachname: "Beispiel",
  email: "berta@example.de",
  telefon: "069 1234567",
  text_version: LIGA_KENNTNISNAHME.textVersion,
} as const;

/** The writes that mint a seat's link, and so spend the one it held. */
const MINTS = ["erneutSendenEinwilligung", "korrigierenKontaktEmail", "besetzenKontaktSitz"];

/** The application read as the page drew it, with the deadline a seat's link stood under before any repair. */
const VOR_DER_REPARATUR = { bewerbung: { ...GELESEN.bewerbung, bestaetigungsfrist: "2026-09-01" } };

/**
 * The application read, answering `before` until a repair's write has landed and `after` from then
 * on, an `Error` as a read that failed: the message is composed from the read that follows the write.
 */
function readAcrossTheWrite(before: unknown, after: unknown): void {
  readWith(() => {
    const answer = writes.some(({ action }) => MINTS.includes(action)) ? after : before;
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
}

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

/** What the re-send's write answers where it lands, minting `token-neu` for the seat and mailbox it matched. */
const erneutGeschrieben = (overrides: object = {}) => ({
  acknowledged: 1,
  token: "token-neu",
  rolle: "ansprechperson",
  email: PERSON.email,
  rollen: ["ansprechperson"],
  bestaetigungsfrist: "2026-09-18",
  ...overrides,
});

/** What the correction's write answers where it lands. */
const korrigiert = () => ({
  acknowledged: 1,
  email: KORREKTUR.email,
  rollen: ["ansprechperson"],
  token: "token-korrektur",
  bestaetigungsfrist: "2026-09-18",
});

/** What the reseat's write answers where it lands, for the seats it filled. */
const besetzt = (rollen: readonly string[] = ["ansprechperson"]) => ({
  acknowledged: 1,
  rollen: rollen,
  token: "token-sitz",
  bestaetigungsfrist: "2026-09-18",
});

/** A success's report, or the refusal's sentence where the action failed. */
const answerOf = (result: { success: boolean; message?: string; error?: string }): string => result.message ?? result.error ?? "";

/** What a landed write that moves no cached read leaves in `cacheCalls`: the spine's refresh, and nothing else. */
const REFRESH_ALONE = [{ name: "refresh", args: [] }];

describe("what each decision moves", () => {
  /* The acceptance created or entered a club, which is what the cached team reads answer. Both tags
     or neither: the base one alone leaves a season-scoped read stale, and the granular one alone
     leaves every unscoped read stale. */
  it("invalidates the club reads the acceptance wrote into", async () => {
    const [acceptance] = DECISIONS;
    answerWith(() => Promise.resolve(acceptance.landed(ENTSCHIEDEN)));

    assert.equal((await acceptance.press()).success, true, "the acceptance never landed, so its tags are judged on nothing");
    assert.deepEqual(
      cacheCalls,
      [{ name: "updateTag", args: ["teams"] }, { name: "updateTag", args: ["teams:saison_id:2026"] }, ...REFRESH_ALONE],
      "the acceptance clears other than the club reads it wrote into",
    );
  });

  /* A decline moves this application's own `status` and `entscheidung`, and nothing cached holds an
     application: both triage reads are uncached because an application is personal data. */
  it("moves no tag on a decline", async () => {
    const [, decline] = DECISIONS;
    answerWith(() => Promise.resolve(decline.landed(ENTSCHIEDEN)));

    assert.equal((await decline.press()).success, true, "the decline never landed, so its tags are judged on nothing");
    assert.deepEqual(cacheCalls, REFRESH_ALONE, "the decline clears a cached read its endpoint does not move");
  });
});

describe("the message that follows a decision", () => {
  /* After the write in both, and the write is what the report is about: a message sent first would
     tell a school it was accepted over a request the backend went on to refuse. */
  it("mails nothing where the API write is refused", async () => {
    for (const { where, operation, press } of DECISIONS) {
      answerWith(() => Promise.reject(refusedOn(operation, "REQ-BEWERBUNG-001")));

      const result = await press();

      assert.equal(result.success, false, `${where} was not refused, so the mail below is judged on nothing`);
      assert.deepEqual(mailed, [], `${where} told the school of a decision the backend refused`);
    }
  });

  /* The decision is committed and no endpoint takes it back, so nothing after the send may report a
     failure — the addresses that were not reached travel in the success message instead. */
  it("reports the decision as taken whatever the mail did", async () => {
    recorders.__flBewerbungMailRefused = true;

    for (const { where, betreff, landed, press } of DECISIONS) {
      answerWith(() => Promise.resolve(landed(ENTSCHIEDEN)));

      const result = await press();

      assert.equal(result.success, true, `${where} fails the whole decision over a message it could not send`);
      assert.match(answerOf(result), new RegExp(`Die ${betreff} konnte niemandem zugestellt werden`), `${where} drops the delivery report`);
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
  ...renderedBy("the triage", mapTriageRefusal(refusedOn(ANNEHMEN_OPERATION, "REQ-ENTER-005"), "bestehendes_team")),
  ...renderedBy("the club editor's entry", mapEntryRefusal(refusedOn(ENTRY_OPERATION, "REQ-ENTER-005"))),
  ...renderedBy(
    "the club editor's replacement",
    mapReplacementRefusal(refusedOn("POST /teams/{team_id}/saisons/{saison_id}/replace", "REQ-ENTER-005")),
  ),
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
 * repair is written as an imperative (`docs/frontend/spec.md` §1.12).
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
      assert.match(object!, REACTIVATED_OBJECT, `${where} reactivates „${object!}“, which does not agree with the neuter „Team“`);
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
    assert.equal(
      RETIRED_RENDERINGS.length,
      6,
      `REQ-ENTER-005 is rendered in ${String(RETIRED_RENDERINGS.length)} places, not the six this case reads`,
    );
    for (const { where, sentences } of RETIRED_RENDERINGS) {
      assert.notEqual(sentences.length, 0, `${where} holds no rendered sentence`);
    }
  });

  /* `REQ-ENTER-005` is `inactive_since`, whose verb pair `docs/glossary.md :: inactive_since` fixes:
     _stilllegen_ retires the club across the league, _austragen_ takes one squad row out of one
     season. „Verlassen“ is an `austritt`, a third record on a third page. */
  it("calls a retired club stillgelegt in every branch that answers it", () => {
    for (const { where, german } of RETIRED_RENDERINGS) {
      assert.ok(german.includes("stillgelegt"), `${where} gives REQ-ENTER-005 a state word other than „stillgelegt“`);
      assert.match(german, /\bTeam\b/, `${where} names the club as something other than a „Team“`);

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
 * The entry rules an acceptance and the club editor both answer. `REQ-ENTER-004` is not among them:
 * it guards a group MOVE, which no acceptance performs.
 */
const SHARED_ENTRY_CODES = ["REQ-ENTER-001", "REQ-ENTER-002", "REQ-ENTER-003"];

const ENTRY_RENDERINGS = SHARED_ENTRY_CODES.map((code) => ({
  code: code,
  renderings: renderingsOf([
    ...renderedBy("the triage", acceptanceMapped(refusedOn(ANNEHMEN_OPERATION, code))),
    ...renderedBy("the club editor", mapEntryRefusal(refusedOn(ENTRY_OPERATION, code))),
  ]),
}));

describe("the sentence both entry surfaces render for one code", () => {
  for (const { code, renderings } of ENTRY_RENDERINGS) {
    /* The opening sentence and not the whole message: a repair names a control, and the two surfaces
       have different ones — the triage declines an application, the club editor picks a season. */
    it(`opens ${code} with one sentence, spelled the same on both`, () => {
      // Before the comparison: a cut that stopped matching leaves one side empty, and two empty
      // sides are equal.
      assert.equal(renderings.length, 2, `${code} is rendered in ${String(renderings.length)} places, not the two this case reads`);
      for (const { where, sentences } of renderings) {
        assert.notEqual(sentences.length, 0, `${where} was cut to something holding no rendered sentence for ${code}`);
      }

      const [first, second] = renderings;

      assert.equal(second?.sentences[0], first?.sentences[0], `the two surfaces open ${code} with different sentences`);
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

    assert.equal(parsed.success, false, "a whitespace-only reason parses, and would be stored and mailed as one");
    assert.equal(
      FLAblehnenBewerbungPayloadSchema.safeParse({ id: "68d0f2a4c1e2b3a4d5e6f708", grund: "  Kein Platz.  " }).data?.grund,
      "Kein Platz.",
      "the reason reaches the write with the padding the administrator typed around it",
    );
  });

  /* A reason at the cap with padding around it: the schema takes it, so the panel that measures the
     raw string disables the button and counts past the cap over a reason the school would have read. */
  it("takes a reason whose padding is all that carries it past the cap", () => {
    const padded = `  ${"a".repeat(BEWERBUNG_GRUND_MAX_LENGTH)}  `;
    const parsed = FLAblehnenBewerbungPayloadSchema.safeParse({ id: "68d0f2a4c1e2b3a4d5e6f708", grund: padded });

    assert.equal(parsed.success, true, "a reason inside the cap once trimmed is refused by the schema");
    assert.equal(parsed.data?.grund.length, BEWERBUNG_GRUND_MAX_LENGTH);
  });
});

describe("the pills the queue's card wears", () => {
  /* A pill that cannot break overruns the cell it sits in instead of wrapping inside it, and a
     card's own grid track is where one gets narrow enough to break. */
  it("never lets a pill break across two lines", () => {
    assert.match(labelBadge("info"), /\bwhitespace-nowrap\b/, "a pill breaks across two lines, where it reads as two pills");
  });
});

describe("a message that cannot be sent", () => {
  /* Thrown out of a decision, a read AFTER its write turns one that stands into a reported failure,
     and the retry it invites is refused as already taken (`REQ-BEWERBUNG-001`). Thrown BEFORE the
     re-send's mint, the same read has cost nothing. */
  it("reports a decision whose club read failed as taken, and tells the administrator to write to the contacts", async () => {
    clubsWith(() => Promise.reject(new Error("the club list answered nothing")));

    for (const { where, betreff, landed, press } of DECISIONS) {
      // A picked club, whose name only the club list answers.
      answerWith(() => Promise.resolve(landed({ ...ENTSCHIEDEN, schule: null, team_id: GEWAEHLT.bewerbung.team_id })));

      const result = await press();

      assert.equal(result.success, true, `${where} reports a committed decision as one that did not happen`);
      assert.match(
        answerOf(result),
        new RegExp(`Die ${betreff} konnte nicht verschickt werden\\. Melde Dich selbst bei den Kontaktpersonen der Bewerbung\\.`),
        `${where} leaves the administrator no remedy for the message nobody received`,
      );
    }
  });

  it("lets the club read that precedes a mint throw, before any link is spent", async () => {
    readWith(() => Promise.resolve(GEWAEHLT));
    clubsWith(() => Promise.reject(new Error("the club list answered nothing")));

    for (const [where, press, mint] of [
      ["the re-send", () => einwilligungErneutSendenAction(ERNEUT), "erneutSendenEinwilligung"],
      ["the correction", () => kontaktEmailKorrigierenAction(KORREKTUR), "korrigierenKontaktEmail"],
      ["the reseat", () => besetzeKontaktSitzAction(SITZ), "besetzenKontaktSitz"],
    ] as const) {
      const result = await press();

      assert.equal(result.success, false, `${where} answered as though the club read had not failed`);
      assert.deepEqual(
        writes.filter(({ action }) => action === mint),
        [],
        `${where} spent the seat's link before a club read that could not compose its message`,
      );
    }
  });
});

describe("the re-sent confirmation link", () => {
  it("answers every code the re-send publishes through its own mapper", async () => {
    for (const code of publishedRefusals(ERNEUT_OPERATION)) {
      assert.notEqual(
        answerShown(ERNEUT_OPERATION, code, mapEinwilligungErneutRefusal),
        null,
        `${code} is published on the re-send and reaches the admin unmapped`,
      );
    }
    await assertEachAnswered({
      operation: ERNEUT_OPERATION,
      refuseWith: answerWith,
      act: () => einwilligungErneutSendenAction({ id: BEWERBUNG_ID, rolle: "ansprechperson" }),
      mapped: mapEinwilligungErneutRefusal,
    });
  });

  /* A link built on the published origin sends a reader of the local stack into production
     (`docs/frontend/spec.md :: I186`). */
  it("mints the re-sent link on the configured origin", async () => {
    mailed.length = 0;
    const frist = "2026-09-18";
    readWith(() => Promise.resolve({ bewerbung: { ...GELESEN.bewerbung, bestaetigungsfrist: frist } }));
    answerWith(() =>
      Promise.resolve({
        acknowledged: 1,
        token: "token-neu",
        rolle: "ansprechperson",
        email: PERSON.email,
        rollen: ["ansprechperson"],
        bestaetigungsfrist: frist,
      }),
    );

    const result = await einwilligungErneutSendenAction({ id: BEWERBUNG_ID, rolle: "ansprechperson" });

    assert.equal(result.success, true, "the re-send mailed nothing, so the origin below is judged on nothing");
    assert.ok(
      mailed.some(({ text }) => text.includes(`${ORIGIN}/bestaetigung/kontakt?token=token-neu`)),
      "the re-sent link is minted on an origin this run was not configured with",
    );
  });

  /* The token is minted and the deadline moved by the time the message is composed, so the read that
     carries the new deadline has to come after the write rather than from the page's own copy. */
  it("mails nothing where the write is refused, and states the deadline the write set", async () => {
    answerWith(() => Promise.reject(refusedOn(ERNEUT_OPERATION, publishedRefusals(ERNEUT_OPERATION)[0] ?? "")));

    assert.equal((await einwilligungErneutSendenAction(ERNEUT)).success, false, "the re-send was not refused, so nothing is judged");
    assert.equal(mailed.length, 0, "the re-send mailed a link the backend refused to mint");

    // The refused write is recorded too, and the read below tells before from after by the writes.
    writes.length = 0;
    readAcrossTheWrite(VOR_DER_REPARATUR, { bewerbung: { ...GELESEN.bewerbung, bestaetigungsfrist: "2026-09-18" } });
    answerWith(() => Promise.resolve(erneutGeschrieben()));

    assert.equal(
      (await einwilligungErneutSendenAction(ERNEUT)).success,
      true,
      "the re-send mailed nothing, so the deadline is judged on nothing",
    );
    assert.ok(
      mailed[0]?.text.includes(formatSpielDatum("2026-09-18")),
      "the message states the deadline the page held, not the one the write set",
    );
  });

  /* Judged before the mint, because `compose_erneut_update` replaces the seat's entry whole: a press
     that could never compose a message would otherwise void the link that seat is holding. */
  it("refuses what it could not send before it spends the seat's link", async () => {
    const answers = await unsendableAnswers();

    assert.match(answers.weg, /Diese Bewerbung gibt es nicht mehr/);
    assert.match(answers.leer, /Für diese Rolle steht niemand mehr in der Bewerbung/);
    assert.equal(answers.ohneAdresse, ERNEUT_OHNE_ADRESSE);
    assert.match(answers.ohneTeam, /Diese Bewerbung nennt kein Team/);
    assert.deepEqual(writes, [], "the re-send spent the seat's link on a press that could never compose its message");
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
    recorders.__flBewerbungMailRefused = true;
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(erneutGeschrieben()));
    const unsent = errorOf(await einwilligungErneutSendenAction(ERNEUT));

    const saetze = [...unsendable, unsent].map(comparable);

    assert.ok(
      saetze.every((satz) => satz !== ""),
      `a re-send answered with no sentence at all: ${saetze.join(" | ")}`,
    );
    assert.equal(new Set(saetze).size, saetze.length, "two of the re-send's answers say the same thing");
  });

  /* A success title over a message that never went out leaves an administrator waiting on an answer
     to a link that reached nobody, while the seat's previous one is spent. */
  it("answers a message that did not go out as a failure, naming what the press cost", async () => {
    recorders.__flBewerbungMailRefused = true;
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(erneutGeschrieben()));

    const result = await einwilligungErneutSendenAction(ERNEUT);

    assert.equal(result.success, false, "a refused send is still reported as a link on its way");
    assert.match(errorOf(result), /Der alte Link gilt nicht mehr/, "the failure does not say the previous link is spent");
    assert.match(errorOf(result), /Versuche es noch einmal/, "the failure names no way out");
  });

  /* The spine leaves a refusal standing, and a message that did not go leaves the mint standing: the
     seat's old link is spent and its deadline moved, which the page shows. */
  it("refreshes the page after a re-send whose message did not go", async () => {
    readAcrossTheWrite(VOR_DER_REPARATUR, null);
    answerWith(() => Promise.resolve(erneutGeschrieben()));

    const result = await einwilligungErneutSendenAction(ERNEUT);

    assert.equal(result.success, false, "the message went, so the refresh below is judged on nothing");
    assert.equal(cacheCalls.filter(({ name }) => name === "refresh").length, 1, "the page keeps a link the mint has already spent");
  });

  /* The endpoint writes the deadline in the same update that mints the token, so an application
     answering none afterwards is a contract broken rather than a state to word for an administrator. */
  it("throws where the write it has just made answers no deadline", async () => {
    readAcrossTheWrite(VOR_DER_REPARATUR, { bewerbung: { ...GELESEN.bewerbung, bestaetigungsfrist: null } });
    answerWith(() => Promise.resolve(erneutGeschrieben()));

    const result = await einwilligungErneutSendenAction(ERNEUT);
    const thrown = logged.find(([line]) => line === "Admin mutation failed: einwilligungErneutSendenAction")?.[1];

    assert.equal(result.success, false);
    assert.ok(
      thrown instanceof Error && /Bestätigungsfrist/.test(thrown.message),
      "a missing deadline is worded for an administrator rather than thrown",
    );
    assert.deepEqual(mailed, [], "a message went out stating no deadline");
  });

  /* The throw above lands after the mint, which stands behind it as behind a refused send. */
  it("refreshes the page after a re-send that threw after the mint", async () => {
    readAcrossTheWrite(VOR_DER_REPARATUR, { bewerbung: { ...GELESEN.bewerbung, bestaetigungsfrist: null } });
    answerWith(() => Promise.resolve(erneutGeschrieben()));

    await einwilligungErneutSendenAction(ERNEUT);

    assert.equal(cacheCalls.filter(({ name }) => name === "refresh").length, 1, "the page keeps a link the mint has already spent");
  });

  /* A correction landing between the page's read and this write moves the mailbox, and only the
     write's own image knows it: the read would mail the address the correction replaced. */
  it("mails the address and the seats the write itself answered", async () => {
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(erneutGeschrieben({ email: "anna.neu@example.de", rollen: ["trainer", "ansprechperson"] })));

    await einwilligungErneutSendenAction(ERNEUT);

    assert.deepEqual(
      mailed.map(({ to }) => to),
      ["anna.neu@example.de"],
      "the re-send mails the address its own read held",
    );
    assert.ok(mailed[0]?.text.includes(rollenText(["trainer", "ansprechperson"])), "the re-send names seats its own read paired");
  });

  /* The one thing on this path that must not reach a second reader. A toast, a log line or a returned
     sentence carrying it hands the seat's credential to whoever can see the screen or the stream. */
  it("spells the minted token into the link and into nothing else", async () => {
    const token = "token-geheim";
    const results: unknown[] = [];

    // Every path a minted token is in scope on that answers or logs: a landed send, a refused one,
    // a failed read after the write, and each repair's caught throw.
    readAcrossTheWrite(VOR_DER_REPARATUR, VOR_DER_REPARATUR);
    answerWith(() => Promise.resolve(erneutGeschrieben({ token })));
    results.push(await einwilligungErneutSendenAction(ERNEUT));
    assert.ok(
      mailed.some(({ text }) => text.includes(bestaetigungsLink(ORIGIN, token))),
      "the landed send mailed no link, so the token is judged on nothing",
    );

    recorders.__flBewerbungMailRefused = true;
    results.push(await einwilligungErneutSendenAction(ERNEUT));
    recorders.__flBewerbungMailRefused = false;

    writes.length = 0;
    readAcrossTheWrite(VOR_DER_REPARATUR, new Error("the read after the write answered nothing"));
    results.push(await einwilligungErneutSendenAction(ERNEUT));

    for (const [press, answer] of [
      [() => kontaktEmailKorrigierenAction(KORREKTUR), { acknowledged: 1, token, email: KORREKTUR.email, rollen: ["ansprechperson"] }],
      [() => besetzeKontaktSitzAction(SITZ), { acknowledged: 1, token, rollen: ["ansprechperson"] }],
    ] as const) {
      writes.length = 0;
      readAcrossTheWrite(VOR_DER_REPARATUR, { bewerbung: { ...GELESEN.bewerbung, bestaetigungsfrist: null } });
      answerWith(() => Promise.resolve({ ...answer, bestaetigungsfrist: "2026-09-18" }));
      results.push(await press());
    }

    // The module logs on these paths, so a stream that recorded nothing is this case broken rather
    // than a clean module.
    assert.ok(logged.length > 0, "no logger call was recorded at all, so nothing below was judged");

    const spelled = (value: unknown): string =>
      JSON.stringify(value, (_key, inner: unknown) =>
        inner instanceof Error ? `${inner.name}: ${inner.message} ${inner.stack ?? ""}` : inner,
      );
    for (const args of logged) assert.ok(!spelled(args).includes(token), `a log line names the token: ${spelled(args)}`);
    for (const result of results) assert.ok(!spelled(result).includes(token), `an answer names the token: ${spelled(result)}`);
  });

  /* This moves the application's own confirmation block and its deadline, and no cached read holds an
     application: both triage reads are uncached because an application is personal data. */
  it("moves no tag", async () => {
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(erneutGeschrieben()));

    assert.equal((await einwilligungErneutSendenAction(ERNEUT)).success, true, "the re-send never landed, so its tags are judged on nothing");
    assert.deepEqual(cacheCalls, REFRESH_ALONE, "the re-send clears a cached read its endpoint does not move");
  });
});

describe("the corrected contact address", () => {
  it("answers every code the correction publishes through its own mapper", async () => {
    for (const code of publishedRefusals(KORREKTUR_OPERATION)) {
      assert.notEqual(
        answerShown(KORREKTUR_OPERATION, code, mapKontaktEmailRefusal),
        null,
        `${code} is published on the correction and reaches the admin unmapped`,
      );
    }
    await assertEachAnswered({
      operation: KORREKTUR_OPERATION,
      refuseWith: answerWith,
      act: () => kontaktEmailKorrigierenAction({ id: BEWERBUNG_ID, rolle: "ansprechperson", email: "anna.neu@example.de" }),
      mapped: mapKontaktEmailRefusal,
    });
  });

  /* The read that carries the person's first name was taken BEFORE the write, so it still holds the
     address the correction replaced. Mailing that one sends the new link to the bounced mailbox. */
  it("mails the address the write stored, never the one the read still holds", async () => {
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(korrigiert()));

    await kontaktEmailKorrigierenAction(KORREKTUR);

    assert.deepEqual(
      mailed.map(({ to }) => to),
      [KORREKTUR.email],
      "the correction composes its message against the address the application held before the write",
    );
  });

  /* The address IS corrected whatever the message did, so a failure arm here would tell the
     administrator to try a correction that has already happened. */
  it("reports a corrected address whose message did not go as a correction that stands", async () => {
    recorders.__flBewerbungMailRefused = true;
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(korrigiert()));

    const result = await kontaktEmailKorrigierenAction(KORREKTUR);

    assert.equal(result.success, true, "a refused send reports the correction as one that did not happen");
    assert.equal(result.success ? result.verschickt : undefined, false, "a refused send reports a link on its way");
    assert.match(answerOf(result), /Der alte Link gilt nicht mehr/, "the report does not say the previous link is spent");
  });

  /* The send throws where the write it follows answered no deadline, and `runAdminMutation` turns a
     throw into `success: false` — which raises „Adresse nicht korrigiert“ over an address that is
     written, with the seat's previous link already dead. */
  it("catches a message that threw, the address being stored before it is composed", async () => {
    readAcrossTheWrite(VOR_DER_REPARATUR, { bewerbung: { ...GELESEN.bewerbung, bestaetigungsfrist: null } });
    answerWith(() => Promise.resolve(korrigiert()));

    const result = await kontaktEmailKorrigierenAction(KORREKTUR);

    assert.equal(result.success, true, "a throw from the send escapes the correction as a write that did not happen");
    assert.equal(result.success ? result.verschickt : undefined, false);
    assert.match(answerOf(result), /Der alte Link gilt nicht mehr/, "the caught throw answers with something other than no link sent");
  });

  /* One press writes every seat the person holds (`fl_frontend/src/features/bewerbungen/bestaetigungStand.ts :: gepaarteSitze`), so
     the message names both or a reader goes looking for a second link that will never come. */
  it("names every seat of a mirrored pair in the message it sends", async () => {
    readWith(() =>
      Promise.resolve({
        bewerbung: {
          ...VOR_DER_REPARATUR.bewerbung,
          kontakte: { trainer: PERSON, ansprechperson: PERSON, stellvertretung: null, trainer_ist_zugleich: "ansprechperson" },
          bestaetigungen: { trainer: { bestaetigt_am: null }, ansprechperson: { bestaetigt_am: null }, stellvertretung: null },
        },
      }),
    );
    answerWith(() => Promise.resolve(korrigiert()));

    await kontaktEmailKorrigierenAction(KORREKTUR);

    assert.ok(mailed[0]?.text.includes(rollenText(["trainer", "ansprechperson"])), "the correction names one seat of a mirrored pair");
  });

  it("moves no tag", async () => {
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(korrigiert()));

    assert.equal(
      (await kontaktEmailKorrigierenAction(KORREKTUR)).success,
      true,
      "the correction never landed, so its tags are judged on nothing",
    );
    assert.deepEqual(cacheCalls, REFRESH_ALONE, "the correction clears a cached read its endpoint does not move");
  });
});

describe("the person seated where one stepped out", () => {
  it("answers every code the reseat publishes through its own mapper", async () => {
    for (const code of publishedRefusals(SITZ_OPERATION)) {
      assert.notEqual(
        answerShown(SITZ_OPERATION, code, mapKontaktSitzRefusal),
        null,
        `${code} is published on the reseat and reaches the admin unmapped`,
      );
    }
    await assertEachAnswered({
      operation: SITZ_OPERATION,
      refuseWith: answerWith,
      act: () =>
        besetzeKontaktSitzAction({
          id: BEWERBUNG_ID,
          rolle: "ansprechperson",
          vorname: "Berta",
          nachname: "Beispiel",
          email: "berta@example.de",
          telefon: "069 1234567",
          text_version: LIGA_KENNTNISNAHME.textVersion,
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

    assert.equal(result.success, true, `the reseat refuses the seat state it exists to repair: ${answerOf(result)}`);
    assert.ok(
      writes.some(({ action }) => action === "besetzenKontaktSitz"),
      "the reseat never reached its write",
    );
  });

  it("still refuses what it cannot compose a message from, before it seats anybody", async () => {
    readWith(() => Promise.resolve(null));
    assert.match(errorOf(await besetzeKontaktSitzAction(SITZ)), /Diese Bewerbung gibt es nicht mehr/);

    readWith(() => Promise.resolve({ bewerbung: { ...VOR_DER_REPARATUR.bewerbung, schule: null, team_id: null } }));
    assert.match(errorOf(await besetzeKontaktSitzAction(SITZ)), /Diese Bewerbung nennt kein Team/);

    assert.deepEqual(writes, [], "the reseat seated a person behind a message nobody could compose");
  });

  /* `gepaarteSitze` mirrors `paired_seat`, which drops a seat missing either half — and every seat
     this write fills was emptied, so a message composed from it names one seat of a pair. */
  it("names the seats the write itself answered rather than recomputing the pair", async () => {
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(besetzt(["trainer", "ansprechperson"])));

    await besetzeKontaktSitzAction(SITZ);

    assert.ok(mailed[0]?.text.includes(rollenText(["trainer", "ansprechperson"])), "the reseat recomputes a pair the emptied slots hide");
  });

  /* The person IS seated whatever the message did, so a failure arm here would tell the
     administrator to seat somebody who is already in the application. */
  it("reports a filled seat whose message did not go as a seat that stands", async () => {
    readAcrossTheWrite(VOR_DER_REPARATUR, { bewerbung: { ...GELESEN.bewerbung, bestaetigungsfrist: null } });
    answerWith(() => Promise.resolve(besetzt()));
    const thrown = await besetzeKontaktSitzAction(SITZ);

    writes.length = 0;
    recorders.__flBewerbungMailRefused = true;
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    const refused = await besetzeKontaktSitzAction(SITZ);

    for (const [how, result] of [
      ["a throw from the send", thrown],
      ["a refused send", refused],
    ] as const) {
      assert.equal(result.success, true, `${how} reports the seat as one that was never filled`);
      assert.equal(result.success ? result.verschickt : undefined, false, `${how} reports a link on its way`);
      assert.match(answerOf(result), /Der alte Link gilt nicht mehr/, `${how} is reported as something other than no link sent`);
    }
  });

  it("moves no tag", async () => {
    readWith(() => Promise.resolve(VOR_DER_REPARATUR));
    answerWith(() => Promise.resolve(besetzt()));

    assert.equal((await besetzeKontaktSitzAction(SITZ)).success, true, "the reseat never landed, so its tags are judged on nothing");
    assert.deepEqual(cacheCalls, REFRESH_ALONE, "the reseat clears a cached read its endpoint does not move");
  });
});
