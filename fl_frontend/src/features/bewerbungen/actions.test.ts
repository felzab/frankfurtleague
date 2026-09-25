import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { LIGA_KENNTNISNAHME } from "@/core/einwilligung.ts";
import { doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { answerShown, assertEachAnswered, DUPLICATE_KEY, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { sliceBetween } from "@/shared/testing/sourceText.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import { labelBadge } from "../../shared/components/ui/badges.ts";
import { buildTeamBanners } from "../teams/components/forms/AdminTeamEditForm/banners.ts";
import { mapAlreadyEnteredRefusal, mapEntryRefusal, mapReplacementRefusal } from "../teams/refusals.ts";
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

/* The real actions, called: the request they run in, the application three of them read first and
   the writes they send are the doubles. */
doubleActionRequest();
const { answerWith } = doubleActions({ modules: ["/src/features/bewerbungen/mutations.ts"] });
const { answerWith: readWith } = doubleActions({ modules: ["/src/features/bewerbungen/queries.ts"], answer: () => Promise.resolve(GELESEN) });
const {
  ablehnenBewerbungAction,
  annehmenBewerbungAction,
  besetzeKontaktSitzAction,
  einwilligungErneutSendenAction,
  kontaktEmailKorrigierenAction,
} = await import("./actions.ts");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
/** Read for the codes each mapper's own switch names, which no call can enumerate. */
const REFUSALS = readFileSync(path.resolve(import.meta.dirname, "refusals.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
const SCHEMAS = readFileSync(path.resolve(import.meta.dirname, "schemas.ts"), "utf8");
const CONSTANTS = readFileSync(path.resolve(import.meta.dirname, "constants.ts"), "utf8");
/** The bound the decline's reason is mirrored from, read where it is written. */
const BOUNDS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "shared", "schemas", "bounds.py"), "utf8");

/** The two decision messages, read for the fields their call sites in `actions.ts` have to fill. */
const EMAIL = readFileSync(path.resolve(REPO_ROOT, "fl_frontend", "src", "core", "bewerbungEmail.ts"), "utf8");

const ANNEHMEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/annehmen";
const ABLEHNEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/ablehnen";
const ERNEUT_OPERATION = "POST /bewerbungen/{bewerbung_id}/einwilligung/{seat}/erneut";
/** Where the entry rules acceptance REUSES are declared: they belong to the season's boundary, not the triage's. */
const ENTRY_OPERATION = "POST /teams/{team_id}/saisons";

/** The season's entry rules, which `annehmen_bewerbung` reaches rather than restating, and so the ones an acceptance can answer. */
const REUSED_ENTRY_CODES = ["REQ-ENTER-001", "REQ-ENTER-002", "REQ-ENTER-003", "REQ-ENTER-005"];

const MAPPER = sliceBetween(REFUSALS, "export function mapTriageRefusal", "export function mapEinwilligungErneutRefusal");
const ANNEHMEN_ACTION = sliceBetween(ACTIONS, "export async function annehmenBewerbungAction", "export async function ablehnenBewerbungAction");
const ABLEHNEN_ACTION = sliceBetween(ACTIONS, "export async function ablehnenBewerbungAction", "const BEWERBUNG_WEG");
/** Everything both decisions run AFTER their write has committed. */
const NOTIFY = sliceBetween(ACTIONS, "async function notifyBewerbung", "export async function annehmenBewerbungAction");

const ERNEUT_MAPPER = sliceBetween(REFUSALS, "export function mapEinwilligungErneutRefusal", "const ANGABEN_STEHEN_FEST");
/** Every sentence the re-send answers with instead of a link, read as its declaration writes it. */
const resendSentence = (name: string): string => new RegExp(String.raw`const ` + name + String.raw` =([\s\S]*?);\n`).exec(ACTIONS)?.[1] ?? "";
/** What the re-send runs after its own write, which is where the minted token is spent. */
const ERNEUT_SENDER = sliceBetween(ACTIONS, "async function sendeBestaetigungErneut", "export async function einwilligungErneutSendenAction");
const ERNEUT_ACTION = sliceBetween(
  ACTIONS,
  "export async function einwilligungErneutSendenAction",
  "export async function kontaktEmailKorrigierenAction",
);

const KORREKTUR_MAPPER = sliceBetween(REFUSALS, "export function mapKontaktEmailRefusal", "export function mapKontaktSitzRefusal");
const KORREKTUR_ACTION = sliceBetween(
  ACTIONS,
  "export async function kontaktEmailKorrigierenAction",
  "export async function besetzeKontaktSitzAction",
);

/* The last declaration in its module, so its slice runs to the end of the file. */
const SITZ_MAPPER = sliceBetween(REFUSALS, "export function mapKontaktSitzRefusal", null);
/* The reseat is the last declaration in the module, so its slice runs to the end of the file. */
const SITZ_ACTION = sliceBetween(ACTIONS, "export async function besetzeKontaktSitzAction", null);

/** The one field of a submitted application an administrator may move, in the backend's own spelling. */
const KORREKTUR_OPERATION = "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}/email";

/** The one path that writes a whole person onto a submitted application, in the backend's own spelling. */
const SITZ_OPERATION = "POST /bewerbungen/{bewerbung_id}/kontakte/{seat}";

/** Every code the correction answers, read off its own switch rather than the re-send's. */
const korrekturCodes = [...KORREKTUR_MAPPER.matchAll(/case "(REQ-[A-Z]+-\d+)"/g)].map((match) => match[1]!);

/** Every code the reseat answers, read off its own switch rather than the correction's. */
const sitzCodes = [...SITZ_MAPPER.matchAll(/case "(REQ-[A-Z]+-\d+)"/g)].map((match) => match[1]!);

/**
 * Parsed rather than matched: a regex has to guess where a call ends, and the shape it guesses at is
 * the multi-line one — a one-line call then reaches the stream unread by anything below.
 */
function loggerCalls(): { level: string; argument: string }[] {
  const source = ts.createSourceFile(path.resolve(import.meta.dirname, "actions.ts"), ACTIONS, ts.ScriptTarget.Latest, true);
  const found: { level: string; argument: string }[] = [];

  source.forEachChild(function walk(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const callee = node.expression;

      if (ts.isIdentifier(callee.expression) && callee.expression.text === "logger") {
        for (const argument of node.arguments) found.push({ level: callee.name.text, argument: argument.getText(source) });
      }
    }
    node.forEachChild(walk);
  });

  return found;
}

/** Every code the re-send answers, read off its own switch rather than the triage's. */
const erneutCodes = [...ERNEUT_MAPPER.matchAll(/case "(REQ-[A-Z]+-\d+)"/g)].map((match) => match[1]!);

/** Every code the mapper answers, read off its switch. */
const mappedCodes = [...MAPPER.matchAll(/case "(REQ-[A-Z]+-\d+)"/g)].map((match) => match[1]!);

describe("the slices these assertions read", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/sourceText.ts :: sliceBetween`). */
  it("cuts the mapper and both actions out of their files before reading them", () => {
    assert.ok(MAPPER.includes("error.serverErrorCode"), "the mapper's switch is outside its slice");
    assert.ok(!MAPPER.includes("REQ-BEWERBUNG-011"), "the mapper's slice reaches the re-send's");

    assert.ok(ANNEHMEN_ACTION.includes("annehmenBewerbung(validated.data)"), "the acceptance's call is outside its slice");
    assert.ok(!ANNEHMEN_ACTION.includes("ablehnenBewerbung("), "the acceptance's slice reaches the decline");

    assert.ok(ABLEHNEN_ACTION.includes("ablehnenBewerbung(validated.data)"), "the decline's call is outside its slice");
    assert.ok(!ABLEHNEN_ACTION.includes("annehmenBewerbung("), "the decline's slice reaches the acceptance");

    assert.ok(NOTIFY.includes("await resolveBewerbungTeamName("), "the club-name read is outside the notification's slice");
    assert.ok(!NOTIFY.includes("annehmenBewerbung("), "the notification's slice reaches the acceptance");

    assert.ok(mappedCodes.length > 0, "no refusal code could be read out of the mapper at all");
  });

  it("cuts the re-send's mapper, its send and its action apart", () => {
    assert.ok(ERNEUT_MAPPER.includes("error.serverErrorCode"), "the re-send mapper's switch is outside its slice");
    assert.ok(!ERNEUT_MAPPER.includes("REQ-BEWERBUNG-014"), "the re-send mapper's slice reaches the correction's");
    assert.ok(resendSentence("KEIN_LINK_VERSCHICKT") !== "", "the re-send's own sentences are no longer where this file reads them");

    assert.ok(ERNEUT_SENDER.includes("await sendBewerbungMail("), "the re-send's send is outside its slice");
    assert.ok(!ERNEUT_SENDER.includes("erneutSendenEinwilligung("), "the send's slice reaches the write it reports");

    assert.ok(ERNEUT_ACTION.includes("erneutSendenEinwilligung(validated.data)"), "the re-send's call is outside its slice");
    assert.ok(!ERNEUT_ACTION.includes("ablehnenBewerbung("), "the re-send's slice reaches the decline");

    assert.ok(erneutCodes.length > 0, "no refusal code could be read out of the re-send's mapper at all");
  });
});

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
      codes: publishedRefusals(ANNEHMEN_OPERATION),
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
      codes: publishedRefusals(ABLEHNEN_OPERATION),
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
     mapper misses falls through to the 409 fallback (`.claude/rules/cross-surface.md`). */
  it("answers the acceptance's refusal over an unconfirmed seat", () => {
    assert.ok(
      publishedRefusals(ANNEHMEN_OPERATION).includes("REQ-BEWERBUNG-013"),
      "the unconfirmed seat's rule is no longer published on the acceptance",
    );
    assert.match(acceptanceMapped(refusedOn(ANNEHMEN_OPERATION, "REQ-BEWERBUNG-013"))?.error ?? "", /Kontaktperson/);
  });

  it("maps no rule neither decision publishes", () => {
    const published = new Set([...publishedRefusals(ANNEHMEN_OPERATION), ...publishedRefusals(ABLEHNEN_OPERATION)]);

    assert.ok(mappedCodes.length > 0, "no refusal code could be read out of the mapper at all");
    for (const code of mappedCodes) assert.ok(published.has(code), `${code} is mapped here and published on neither decision`);
  });

  /* `REQ-ENTER-004` guards a group MOVE, which no acceptance performs: a row is created here, never
     moved. Reaching it from this action would refuse an acceptance over fixtures it does not touch. */
  it("leaves the group move's own refusal on the move", () => {
    assert.ok(!mappedCodes.includes("REQ-ENTER-004"), "the triage answers the group move's refusal");
    assert.ok(!publishedRefusals(ANNEHMEN_OPERATION).includes("REQ-ENTER-004"), "the document moved the lock onto the acceptance");
  });
});

describe("what each decision moves", () => {
  /* The acceptance created or entered a club, which is what the cached team reads answer. Both tags
     or neither: the base one alone leaves a season-scoped read stale, and the granular one alone
     leaves every unscoped read stale. */
  it("invalidates the club reads the acceptance wrote into", () => {
    assert.ok(ANNEHMEN_ACTION.includes('updateTag("teams")'), "the acceptance stopped invalidating the club reads");
    assert.match(
      ANNEHMEN_ACTION,
      /updateTag\(`teams:saison_id:\$\{annahmeOperation\.saison_id\}`\)/,
      "the acceptance no longer invalidates the season it entered the club into",
    );
  });

  /* A decline moves this application's own `status` and `entscheidung`, and nothing cached holds an
     application: both triage reads are uncached because an application is personal data. */
  it("moves no tag on a decline, and says why", () => {
    assert.ok(!ABLEHNEN_ACTION.includes("updateTag("), "the decline clears a cached read its endpoint does not move");
    assert.match(ABLEHNEN_ACTION, /No tag moves/, "the decline no longer says why it invalidates nothing");
  });
});

describe("the message that follows a decision", () => {
  /* After the write in both, and the write is what the report is about: a message sent first would
     tell a school it was accepted over a request the backend went on to refuse. */
  it("mails only after the API write has answered", () => {
    for (const [slice, call, where] of [
      [ANNEHMEN_ACTION, "annehmenBewerbung(validated.data)", "the acceptance"],
      [ABLEHNEN_ACTION, "ablehnenBewerbung(validated.data)", "the decline"],
    ] as const) {
      const wrote = slice.indexOf(call);
      const notified = slice.indexOf("await notifyBewerbung(");

      assert.notEqual(notified, -1, `${where} sends no message at all`);
      assert.ok(wrote < notified, `${where} sends its message before the write it reports`);
    }
  });

  /* The decision is committed and no endpoint takes it back, so nothing after the send may report a
     failure — the addresses that were not reached travel in the success message instead. */
  it("reports the decision as taken whatever the mail did", () => {
    for (const [slice, where] of [
      [ANNEHMEN_ACTION, "the acceptance"],
      [ABLEHNEN_ACTION, "the decline"],
    ] as const) {
      const notified = slice.indexOf("await notifyBewerbung(");

      assert.ok(!slice.slice(notified).includes("success: false"), `${where} fails the whole decision over a message it could not send`);
      assert.match(slice.slice(notified), /message: /, `${where} drops the delivery report out of what it returns`);
    }
  });
});

describe("how each endpoint is addressed", () => {
  it("posts to the two triage endpoints, with the id in the path", () => {
    assert.match(MUTATIONS, /`\/bewerbungen\/\$\{id\}\/annehmen`/, "the acceptance no longer addresses its own endpoint");
    assert.match(MUTATIONS, /`\/bewerbungen\/\$\{id\}\/ablehnen`/, "the decline no longer addresses its own endpoint");

    for (const endpoint of ["annehmen", "ablehnen"]) {
      assert.match(
        MUTATIONS,
        new RegExp(`${endpoint}\`,\\s*FL\\w+ResponseSchema,\\s*\\{\\s*method: "POST"`),
        `the ${endpoint} is sent as something other than a POST`,
      );
    }
  });

  /* The id is split off into the path by both mutations; a body carrying one is refused whole, the
     backend payloads forbidding an extra field. */
  it("splits the id out of both bodies", () => {
    const splits = [...MUTATIONS.matchAll(/\{ id, \.\.\.fields \}/g)];

    assert.equal(splits.length, 2, `expected both mutations to split the id off, saw ${String(splits.length)}`);
    assert.ok(!MUTATIONS.includes("JSON.stringify(validated.data)"), "a mutation sends the whole payload, id included");
  });
});

/** The German inside one branch: a quoted literal holding a space, which no identifier beside it is. */
const sentencesOf = (rendering: string): string[] => [...rendering.matchAll(/"([^"]*\s[^"]*)"/g)].map((match) => match[1]!);

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
  /* Mirrored, never recalled: past the backend's ceiling the API's `REQ-VAL-001` marks the box with a
     generic sentence rather than the bound's German. */
  it("caps the reason at the number the backend states", () => {
    const backend = /^BEWERBUNG_GRUND_MAX_LENGTH: Final = (\d+)$/m.exec(BOUNDS)?.[1] ?? "";
    const frontend = /^export const BEWERBUNG_GRUND_MAX_LENGTH = (\d+);$/m.exec(CONSTANTS)?.[1] ?? "";

    assert.notEqual(backend, "", "the backend no longer states the bound under that name");
    assert.equal(frontend, backend, "the frontend mirror disagrees with the backend's bound");
    assert.ok(SCHEMAS.includes("BEWERBUNG_GRUND_MAX_LENGTH"), "the payload schema stopped reading the mirrored bound");
    /* The ceiling the schema enforces, beside the mention of it: a wider one written beside the import
       still reads the mirror, and the reason it lets through is the one the API marks no field for. */
    assert.equal(
      FLAblehnenBewerbungPayloadSchema.safeParse({ id: "68d0f2a4c1e2b3a4d5e6f708", grund: "a".repeat(BEWERBUNG_GRUND_MAX_LENGTH + 1) }).success,
      false,
      "a reason one character past the mirrored bound is taken here and refused only by the backend",
    );
  });

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
  it("guards the club-name read that follows a write, and lets the one preceding a mint throw", () => {
    const file = path.resolve(import.meta.dirname, "actions.ts");
    const source = ts.createSourceFile(file, ACTIONS, ts.ScriptTarget.Latest, true);
    const reads: { holder: string; guarded: boolean; at: number }[] = [];

    source.forEachChild(function walk(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "resolveBewerbungTeamName") {
        let guarded = false;
        let holder = "";

        for (let ancestor: ts.Node | undefined = node; ancestor?.parent; ancestor = ancestor.parent) {
          const parent: ts.Node = ancestor.parent;

          // The TRY block specifically: the same call standing in the catch would be unguarded again.
          if (ts.isTryStatement(parent) && parent.tryBlock === ancestor && parent.catchClause) guarded = true;
          if (holder === "" && ts.isFunctionDeclaration(parent) && parent.name !== undefined) holder = parent.name.text;
        }
        reads.push({ holder: holder, guarded: guarded, at: node.getStart(source) });
      }
      node.forEachChild(walk);
    });

    // The exact count rather than a floor: each reader is judged by its own rule below, and a
    // further one is a path whose side of the write nobody has decided.
    assert.equal(reads.length, 4, `expected four club-name readers, found ${String(reads.length)}`);

    const afterTheWrite = reads.find((read) => read.holder === "notifyBewerbung");
    assert.ok(afterTheWrite?.guarded, "a failed club read reports a committed decision as one that did not happen");

    // Each of the three that mint: each reads before its own write, where a throw has cost nothing.
    for (const [holder, schreiben] of [
      ["einwilligungErneutSendenAction", "await erneutSendenEinwilligung("],
      ["kontaktEmailKorrigierenAction", "await korrigierenKontaktEmail("],
      ["besetzeKontaktSitzAction", "await besetzenKontaktSitz("],
    ] as const) {
      const beforeTheMint = reads.find((read) => read.holder === holder);

      assert.ok(beforeTheMint, `${holder} reads the club's name outside the action that mints, where a throw costs a link`);
      assert.ok(
        beforeTheMint.at < ACTIONS.indexOf(schreiben),
        `${holder} reads the club's name after spending the seat's link on a message it may not be able to compose`,
      );
    }
  });

  /* What the administrator is left with: the decision is taken, nobody was written to, and the only
     remedy is theirs. */
  it("tells the administrator to write to the contacts itself", () => {
    assert.match(NOTIFY, /konnte nicht verschickt werden/, "the caught failure reports nothing to the administrator");
    assert.match(NOTIFY, /Melde Dich selbst bei den Kontaktpersonen der Bewerbung\./, "the report names no remedy");
    assert.ok(!NOTIFY.includes("throw"), "the notification throws again, so the committed decision still reports a failure");
  });
});

describe("what each decision message is told", () => {
  /* An OPTIONAL field the call site never fills compiles, lints and builds, and mails the message
     with the sentence it feeds silently missing. Read off the message rather than listed here. */
  it("fills every field the message declares", () => {
    const fields = (block: string) => [...block.matchAll(/^ {2}(\w+)\??:/gm)].map((treffer) => treffer[1]!);
    const acceptMail = fields(sliceBetween(EMAIL, "export interface BewerbungZusageData", "\n}"));
    const declineMail = fields(sliceBetween(EMAIL, "export interface BewerbungAbsageData", "\n}"));

    // Anti-vacuity: a moved interface would leave both lists empty and this assertion true of nothing.
    assert.ok(acceptMail.length > 0 && declineMail.length > 0, "neither message's field list was found, so nothing was compared");

    // The BUILDER's own argument, never the whole action: `gruppe` is also a key of the sentence
    // `describeAufnahme` composes, so a search over the action passes a mail that dropped it.
    const acceptCall = sliceBetween(ACTIONS, "buildBewerbungZusageEmail({", "})");
    const declineCall = sliceBetween(ACTIONS, "buildBewerbungAbsageEmail({", "})");

    assert.ok(acceptCall !== "" && declineCall !== "", "one of the two mail builders is no longer called with an object literal");

    // Collected rather than asserted one at a time: a per-field assertion stops at the first gap, so
    // a second one is invisible until the first is closed.
    const unfilled = [
      ...acceptMail.map((feld) => [feld, acceptCall, "annehmen"] as const),
      ...declineMail.map((feld) => [feld, declineCall, "ablehnen"] as const),
    ]
      .filter(([feld, aufruf]) => !new RegExp(`\\b${feld}:`).test(aufruf))
      .map(([feld, , wo]) => `${wo}/${feld}`)
      .sort();

    assert.deepEqual(unfilled, [], `these declared message fields reach no call site: ${unfilled.join(", ")}`);
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
      codes: publishedRefusals(ERNEUT_OPERATION),
      refuseWith: answerWith,
      act: () => einwilligungErneutSendenAction({ id: BEWERBUNG_ID, rolle: "ansprechperson" }),
      mapped: mapEinwilligungErneutRefusal,
    });
  });

  it("maps no rule the re-send does not publish", () => {
    const published = publishedRefusals(ERNEUT_OPERATION);

    for (const code of erneutCodes) assert.ok(published.includes(code), `${code} is mapped by the re-send and published on it by no rule`);
  });

  it("addresses its own endpoint, with the seat in the path", () => {
    assert.match(MUTATIONS, /`\/bewerbungen\/\$\{id\}\/einwilligung\/\$\{rolle\}\/erneut`/, "the re-send no longer addresses its own endpoint");
  });

  /* The token is minted and the deadline moved by the time the message is composed, so the read that
     carries the new deadline has to come after the write rather than from the page's own copy. */
  it("mails only after the API write has answered", () => {
    const wrote = ERNEUT_ACTION.indexOf("erneutSendenEinwilligung(validated.data)");
    const notified = ERNEUT_ACTION.indexOf("await sendeBestaetigungErneut(");

    assert.notEqual(notified, -1, "the re-send sends no message at all");
    assert.ok(wrote < notified, "the re-send sends its message before the write that mints the token");
    assert.ok(ERNEUT_SENDER.includes("await getBewerbungById("), "the message is composed without re-reading the deadline the write moved");
  });

  /* Judged before the mint, because `compose_erneut_update` replaces the seat's entry whole: a press
     that could never compose a message would otherwise void the link that seat is holding. */
  it("refuses what it could not send before it spends the seat's link", () => {
    const mint = ERNEUT_ACTION.indexOf("await erneutSendenEinwilligung(");

    assert.notEqual(mint, -1, "the re-send no longer calls the write these cases are about");

    for (const [pruefung, satz] of [
      ["gelesen === null", "BEWERBUNG_WEG"],
      ["person === null", "SITZ_LEER"],
      ['person.email === ""', "ERNEUT_OHNE_ADRESSE"],
      ["benanntesTeam === null", "KEIN_TEAM"],
    ] as const) {
      const at = ERNEUT_ACTION.indexOf(pruefung);

      assert.notEqual(at, -1, `the re-send no longer judges \`${pruefung}\``);
      assert.ok(at < mint, `the re-send judges \`${pruefung}\` after a mint that has already voided the seat's link`);
      assert.ok(ERNEUT_ACTION.slice(at, mint).includes(`error: ${satz}`), `\`${pruefung}\` no longer answers with ${satz}`);
    }
  });

  /* One sentence for four states told an administrator the seat had no address where the application
     named no club at all, and the repair each of them offers is a different one. */
  it("gives each of those states a sentence of its own", () => {
    // Punctuation dropped: a refusal built from a reason and a repair carries the stops `buildRefusal`
    // writes, and comparing them would call two identical answers different.
    const comparable = (germanSentences: string[]): string =>
      germanSentences
        .join(" ")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();
    const readBack = (name: string): string => comparable(sentencesOf(resendSentence(name)));

    // The empty address's sentence is the one the strip shares, so it is read off the constant both import.
    const germanSentences = [
      ...["BEWERBUNG_WEG", "SITZ_LEER"].map(readBack),
      comparable([ERNEUT_OHNE_ADRESSE]),
      ...["KEIN_TEAM", "KEIN_LINK_VERSCHICKT"].map(readBack),
    ];

    assert.ok(
      germanSentences.every((satz) => satz !== ""),
      `a re-send sentence reaches no literal at all: ${germanSentences.join(" | ")}`,
    );
    assert.equal(new Set(germanSentences).size, germanSentences.length, "two of the re-send's answers say the same thing");
  });

  /* A success title over a message that never went out leaves an administrator waiting on an answer
     to a link that reached nobody, while the seat's previous one is spent. */
  it("answers a message that did not go out as a failure, naming what the press cost", () => {
    const notified = ERNEUT_ACTION.indexOf("await sendeBestaetigungErneut(");

    assert.notEqual(notified, -1, "the re-send sends no message at all");
    assert.match(
      ERNEUT_ACTION.slice(notified),
      /zustellung\.verschickt \? \{ success: true/,
      "the send's own verdict no longer decides the answer",
    );
    assert.match(
      ERNEUT_ACTION.slice(notified),
      /success: false, error: zustellung\.error/,
      "a refused send is still reported as a link on its way",
    );
    assert.match(ERNEUT_ACTION.slice(notified), /message: /, "the re-send drops the delivery report out of what it returns");

    const costs = resendSentence("KEIN_LINK_VERSCHICKT");

    assert.match(costs, /Der alte Link gilt nicht mehr/, "the failure does not say the previous link is spent");
    assert.match(costs, /Versuche es noch einmal/, "the failure names no way out");
  });

  /* The endpoint writes the deadline in the same update that mints the token, so an application
     answering none afterwards is a contract broken rather than a state to word for an administrator. */
  it("throws where the write it has just made answers no deadline", () => {
    const at = ERNEUT_SENDER.indexOf("frist === null");

    assert.notEqual(at, -1, "the send no longer judges the deadline the write moved");
    assert.match(
      ERNEUT_SENDER.slice(at),
      /^frist === null\) throw new Error\(/,
      "a missing deadline is worded for an administrator rather than thrown",
    );
  });

  /* A correction landing between the page's read and this write moves the mailbox, and only the
     write's own image knows it: the read would mail the address the correction replaced. */
  it("mails the address and the seats the write itself answered", () => {
    const notified = ERNEUT_ACTION.indexOf("await sendeBestaetigungErneut(");

    assert.notEqual(notified, -1, "the re-send sends no message at all");
    assert.match(ERNEUT_ACTION.slice(notified), /email: erneutOperation\.email/, "the re-send mails the address its own read held");
    assert.match(ERNEUT_ACTION.slice(notified), /sitze: erneutOperation\.rollen/, "the re-send names seats its own read paired");
    assert.ok(!ERNEUT_ACTION.includes("gepaarteSitze("), "the re-send recomputes the pair off the page it was drawn from");
    assert.match(SCHEMAS, /FLBewerbungEinwilligungErneutResponseSchema = BaseAPIResponseSchema\.extend\(\{[^}]*email: z\.string\(\)/);
  });

  /* The one thing on this path that must not reach a second reader. A toast, a log line or a returned
     sentence carrying it hands the seat's credential to whoever can see the screen or the stream. */
  it("spells the minted token into the link and into nothing else", () => {
    const link = "bestaetigungsLink(origin, token)";

    assert.ok(ACTIONS.includes(link), "the confirmation link is no longer built where this case reads it");
    assert.ok(!ACTIONS.includes("${token}"), "the minted token is spelled into a string of this module's own");

    const loggedLine = loggerCalls();

    // The module logs, so a walk that found nothing is this sweep broken rather than a clean module.
    assert.ok(loggedLine.length > 0, "no logger call was found at all, so nothing below was judged");

    for (const { level, argument } of loggedLine) {
      // Every call in the module and every argument of it, never the re-send's slice: a line moved
      // one function along is the same credential on the same stream.
      assert.doesNotMatch(argument, /\btoken\b/, `logger.${level} names the token in \`${argument}\``);
      assert.ok(!argument.includes(link), `logger.${level} names the confirmation link in \`${argument}\``);
    }
  });

  /* This moves the application's own confirmation block and its deadline, and no cached read holds an
     application: both triage reads are uncached because an application is personal data. */
  it("moves no tag, and says why", () => {
    assert.ok(!ERNEUT_ACTION.includes("updateTag("), "the re-send clears a cached read its endpoint does not move");
    assert.match(ERNEUT_ACTION, /No tag moves/, "the re-send no longer says why it invalidates nothing");
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
      codes: publishedRefusals(KORREKTUR_OPERATION),
      refuseWith: answerWith,
      act: () => kontaktEmailKorrigierenAction({ id: BEWERBUNG_ID, rolle: "ansprechperson", email: "anna.neu@example.de" }),
      mapped: mapKontaktEmailRefusal,
    });
  });

  it("maps no rule the correction does not publish", () => {
    const published = publishedRefusals(KORREKTUR_OPERATION);

    assert.ok(korrekturCodes.length > 0, "no refusal code could be read out of the correction's mapper at all");
    for (const code of korrekturCodes)
      assert.ok(published.includes(code), `${code} is mapped by the correction and published on it by no rule`);
  });

  it("addresses its own endpoint, with the seat in the path and the address in the body", () => {
    assert.match(MUTATIONS, /`\/bewerbungen\/\$\{id\}\/kontakte\/\$\{rolle\}\/email`/, "the correction no longer addresses its own endpoint");
    assert.match(MUTATIONS, /body: JSON\.stringify\(\{ email: email \}\)/, "the correction sends something other than the address alone");
  });

  /* The read that carries the person's first name was taken BEFORE the write, so it still holds the
     address the correction replaced. Mailing that one sends the new link to the bounced mailbox. */
  it("mails the address the write stored, never the one the read still holds", () => {
    assert.match(
      KORREKTUR_ACTION,
      /email: validated\.data\.email/,
      "the correction composes its message against the address the application held before the write",
    );
  });

  /* The address IS corrected whatever the message did, so a failure arm here would tell the
     administrator to try a correction that has already happened. */
  it("reports a corrected address whose message did not go as a correction that stands", () => {
    assert.match(KORREKTUR_ACTION, /success: true, verschickt: false/, "a refused send reports the correction as one that did not happen");
    assert.ok(!KORREKTUR_ACTION.includes("success: false, error: zustellung.error"), "the correction takes the re-send's failure arm");
  });

  /* The send throws where the write it follows answered no deadline, and `runAdminMutation` turns a
     throw into `success: false` — which raises „Adresse nicht korrigiert“ over an address that is
     written, with the seat's previous link already dead. */
  it("catches a message that threw, the address being stored before it is composed", () => {
    const sentMail = KORREKTUR_ACTION.indexOf("sendeBestaetigungErneut({");
    const caught = KORREKTUR_ACTION.indexOf("} catch (error) {", sentMail);

    assert.notEqual(sentMail, -1, "the correction sends no message at all");
    assert.notEqual(caught, -1, "a throw from the send escapes the correction as a write that did not happen");
    assert.match(
      KORREKTUR_ACTION.slice(caught),
      /success: true, verschickt: false, message: KEIN_LINK_VERSCHICKT/,
      "the caught throw answers with something other than the correction standing and no link sent",
    );
  });

  /* One press writes every seat the person holds (`fl_frontend/src/features/bewerbungen/bestaetigungStand.ts :: gepaarteSitze`), so
     the message names both or a reader goes looking for a second link that will never come. */
  it("names every seat of a mirrored pair in the message it sends", () => {
    assert.match(
      KORREKTUR_ACTION,
      /sitze: gepaarteSitze\(bewerbung, validated\.data\.rolle\)/,
      "the correction names one seat of a mirrored pair",
    );
  });

  it("moves no tag, and says why", () => {
    assert.ok(!KORREKTUR_ACTION.includes("updateTag("), "the correction clears a cached read its endpoint does not move");
    assert.match(KORREKTUR_ACTION, /No tag moves/, "the correction no longer says why it invalidates nothing");
  });
});

describe("the person seated where one stepped out", () => {
  /* First, so a boundary that stopped matching fails here rather than leaving every assertion below
     reading an empty string and passing. */
  it("cuts the reseat's mapper and its action out of the file", () => {
    assert.ok(SITZ_MAPPER.includes("error.serverErrorCode"), "the reseat mapper's switch is outside its slice");
    assert.ok(KORREKTUR_MAPPER.includes("error.serverErrorCode"), "the correction mapper's switch is outside its slice");
    assert.ok(!KORREKTUR_MAPPER.includes("Neu besetzt"), "the correction mapper's slice reaches the reseat's");

    assert.ok(SITZ_ACTION.includes("besetzenKontaktSitz(validated.data)"), "the reseat's call is outside its slice");
    assert.ok(!KORREKTUR_ACTION.includes("besetzenKontaktSitz("), "the correction's slice still runs to the end of the file");

    assert.ok(sitzCodes.length > 0, "no refusal code could be read out of the reseat's mapper at all");
  });

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
      codes: publishedRefusals(SITZ_OPERATION),
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

  it("maps no rule the reseat does not publish", () => {
    const published = publishedRefusals(SITZ_OPERATION);

    for (const code of sitzCodes) assert.ok(published.includes(code), `${code} is mapped by the reseat and published on it by no rule`);
  });

  /* The correction's own path with the `/email` segment dropped, and it takes a body: everything but
     the application and the seat is typed, so a path-only request would seat nobody. */
  it("addresses its own endpoint, with the seat in the path and the person in the body", () => {
    assert.match(MUTATIONS, /`\/bewerbungen\/\$\{id\}\/kontakte\/\$\{rolle\}`/, "the reseat no longer addresses its own endpoint");
    assert.match(MUTATIONS, /body: JSON\.stringify\(person\)/, "the reseat sends something other than the person it was given");
  });

  /* `SITZ_LEER` is the correction's guard on an empty slot, and an empty slot is what this write runs
     ON: copied here it would refuse every press the control is offered for. */
  it("judges no empty seat of its own, that being its entry condition", () => {
    assert.ok(!SITZ_ACTION.includes("SITZ_LEER"), "the reseat refuses the seat state it exists to repair");
    assert.ok(SITZ_ACTION.includes("BEWERBUNG_WEG") && SITZ_ACTION.includes("KEIN_TEAM"), "the reseat stopped judging what it cannot compose");
  });

  /* `gepaarteSitze` mirrors `paired_seat`, which drops a seat missing either half — and every seat
     this write fills was emptied, so a message composed from it names one seat of a pair. */
  it("names the seats the write itself answered rather than recomputing the pair", () => {
    assert.match(SITZ_ACTION, /sitze: sitzOperation\.rollen/, "the reseat recomputes a pair the emptied slots hide");
    assert.ok(!SITZ_ACTION.includes("gepaarteSitze("), "the reseat reads the pair off the page it was drawn from");
  });

  /* The person IS seated whatever the message did, so a failure arm here would tell the
     administrator to seat somebody who is already in the application. */
  it("reports a filled seat whose message did not go as a seat that stands", () => {
    const sentMail = SITZ_ACTION.indexOf("sendeBestaetigungErneut({");
    const caught = SITZ_ACTION.indexOf("} catch (error) {", sentMail);

    assert.notEqual(sentMail, -1, "the reseat sends no message at all");
    assert.notEqual(caught, -1, "a throw from the send escapes the reseat as a write that did not happen");
    assert.match(SITZ_ACTION.slice(caught), /success: true, verschickt: false, message: KEIN_LINK_VERSCHICKT/);
    assert.ok(!SITZ_ACTION.includes("success: false, error: zustellung.error"), "the reseat takes the re-send's failure arm");
  });

  it("moves no tag, and says why", () => {
    assert.ok(!SITZ_ACTION.includes("updateTag("), "the reseat clears a cached read its endpoint does not move");
    assert.match(SITZ_ACTION, /No tag moves/, "the reseat no longer says why it invalidates nothing");
  });
});
