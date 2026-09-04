import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { DECLARED_RULES, declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";
import { LABEL_BADGE } from "../../shared/components/ui/badges.ts";
import { BEWERBUNG_GRUND_MAX_LENGTH } from "./constants.ts";
import { FLAblehnenBewerbungPayloadSchema } from "./schemas.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const MUTATIONS = readFileSync(path.resolve(import.meta.dirname, "mutations.ts"), "utf8");
const SCHEMAS = readFileSync(path.resolve(import.meta.dirname, "schemas.ts"), "utf8");
const CONSTANTS = readFileSync(path.resolve(import.meta.dirname, "constants.ts"), "utf8");
/** The bound the decline's reason is mirrored from, read where it is written. */
const BOUNDS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "shared", "schemas", "bounds.py"), "utf8");
/** The endpoint itself, which is what says which of the season's services an acceptance reaches. */
const ADMIN_ROUTER = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "api", "bewerbungen", "admin_router.py"), "utf8");
/** Where a duplicate key becomes a 409, which is the only channel a Kürzel collision arrives on. */
const EXCEPTION_HANDLERS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "exception_handlers.py"), "utf8");

/**
 * The confirmation panels, read rather than rendered: what they promise is behind a confirmation
 * press.
 */
const PANELS = ["AdminBewerbungAnnehmenSection", "AdminBewerbungAblehnenSection"].map((name) => ({
  name: name,
  source: readFileSync(path.resolve(import.meta.dirname, "components", "forms", `${name}.tsx`), "utf8").replace(/\s+/g, " "),
}));

/** The page holding both decisions, which is what decides whether either panel is on screen at all. */
const VIEW = readFileSync(path.resolve(import.meta.dirname, "components", "views", "AdminBewerbungView.tsx"), "utf8").replace(/\s+/g, " ");

/** The queue, whose columns are allocated rather than measured: fixed layout gives back nothing a cell overruns. */
const TABLE = readFileSync(path.resolve(import.meta.dirname, "components", "collections", "AdminBewerbungenTable.tsx"), "utf8");

/** The readout, whose own `useRouter` is why its header is read rather than rendered. */
const STRIP = readFileSync(path.resolve(import.meta.dirname, "components", "views", "BewerbungBestaetigungStrip.tsx"), "utf8");

/** The club editor's own mapper, which answers `REQ-ENTER-005` about the same stored state this one does. */
const TEAMS_ACTIONS = readFileSync(path.resolve(import.meta.dirname, "..", "teams", "actions.ts"), "utf8");

/** The backend module whose absence from the triage decides which sentence they take. */
const RECORDING = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "recording.py"), "utf8");

/** The two decision messages, read for the fields their call sites in `actions.ts` have to fill. */
const EMAIL = readFileSync(path.resolve(REPO_ROOT, "fl_frontend", "src", "core", "bewerbungEmail.ts"), "utf8");

const ANNEHMEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/annehmen";
const ABLEHNEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/ablehnen";
const ERNEUT_OPERATION = "POST /bewerbungen/{bewerbung_id}/einwilligung/{seat}/erneut";
/** Where the entry rules acceptance REUSES are declared: they belong to the season's boundary, not the triage's. */
const ENTRY_OPERATION = "POST /teams/{team_id}/saisons";

/** The season's entry services, which `annehmen_bewerbung` calls rather than restating. */
const REUSED_SERVICES = ["find_entry_refusal", "find_club_entry_refusal"];

/** The entry rules those services implement, and so the ones an acceptance can answer. */
const REUSED_ENTRY_CODES = ["REQ-ENTER-001", "REQ-ENTER-002", "REQ-ENTER-003", "REQ-ENTER-005"];

const MAPPER = sliceBetween(ACTIONS, "function mapTriageRefusal", "async function resolveBewerbungTeamName");
const ANNEHMEN_ACTION = sliceBetween(ACTIONS, "export async function annehmenBewerbungAction", "export async function ablehnenBewerbungAction");
const ABLEHNEN_ACTION = sliceBetween(ACTIONS, "export async function ablehnenBewerbungAction", "function mapEinwilligungErneutRefusal");
/** Everything both decisions run AFTER their write has committed. */
const NOTIFY = sliceBetween(ACTIONS, "async function notifyBewerbung", "export async function annehmenBewerbungAction");

const ERNEUT_MAPPER = sliceBetween(ACTIONS, "function mapEinwilligungErneutRefusal", "const BEWERBUNG_WEG");
/** Every sentence the re-send answers with instead of a link, read as its declaration writes it. */
const erneutSatz = (name: string): string => new RegExp(String.raw`const ` + name + String.raw` =([\s\S]*?);\n`).exec(ACTIONS)?.[1] ?? "";
/** What the re-send runs after its own write, which is where the minted token is spent. */
const ERNEUT_SENDER = sliceBetween(ACTIONS, "async function sendeBestaetigungErneut", "export async function einwilligungErneutSendenAction");
/* The re-send is the last declaration in the module, so its slice runs to the end of the file. */
const ERNEUT_ACTION = sliceBetween(ACTIONS, "export async function einwilligungErneutSendenAction", null);

/** Every code the re-send answers, read off its own switch rather than the triage's. */
const erneutCodes = [...ERNEUT_MAPPER.matchAll(/case "(REQ-[A-Z]+-\d+)"/g)].map((match) => match[1]!);

/** Every code the mapper answers, read off its switch. */
const mappedCodes = [...MAPPER.matchAll(/case "(REQ-[A-Z]+-\d+)"/g)].map((match) => match[1]!);

describe("the slices these assertions read", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
  it("cuts the mapper and both actions out of the file before reading them", () => {
    assert.ok(MAPPER.includes("error.serverErrorCode"), "the mapper's switch is outside its slice");
    assert.ok(!MAPPER.includes("annehmenBewerbung(validated.data)"), "the mapper's slice reaches the acceptance");

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
    assert.ok(!ERNEUT_MAPPER.includes("sendBewerbungMail("), "the re-send mapper's slice reaches the send");
    assert.ok(erneutSatz("KEIN_LINK_VERSCHICKT") !== "", "the re-send's own sentences are no longer where this file reads them");

    assert.ok(ERNEUT_SENDER.includes("await sendBewerbungMail("), "the re-send's send is outside its slice");
    assert.ok(!ERNEUT_SENDER.includes("erneutSendenEinwilligung("), "the send's slice reaches the write it reports");

    assert.ok(ERNEUT_ACTION.includes("erneutSendenEinwilligung(validated.data)"), "the re-send's call is outside its slice");
    assert.ok(!ERNEUT_ACTION.includes("ablehnenBewerbung("), "the re-send's slice reaches the decline");

    assert.ok(erneutCodes.length > 0, "no refusal code could be read out of the re-send's mapper at all");
  });
});

describe("the triage's refusals against the backend's register", () => {
  /* Before every comparison below: a test looping over an empty declared list maps nothing and
     stays green. An empty list here is the harness failing, not the source. */
  it("finds rules declared against both endpoints and against the entry they reuse", () => {
    assert.ok(declaredCodes(ANNEHMEN_OPERATION).length > 0, `no rule is declared against ${ANNEHMEN_OPERATION}`);
    assert.ok(declaredCodes(ABLEHNEN_OPERATION).length > 0, `no rule is declared against ${ABLEHNEN_OPERATION}`);
    assert.ok(declaredCodes(ENTRY_OPERATION).length > 0, `no rule is declared against ${ENTRY_OPERATION}`);
  });

  it("maps every code the acceptance declares", () => {
    const declared = declaredCodes(ANNEHMEN_OPERATION);

    // A floor rather than the exact set: the register grows an operation onto a rule whenever an
    // endpoint starts reusing it, and what harms an admin is a declared code nobody maps.
    for (const code of ["REQ-BEWERBUNG-001", "REQ-BEWERBUNG-002"]) {
      assert.ok(declared.includes(code), `${code} is no longer declared against the acceptance`);
    }
    for (const code of declared) {
      assert.ok(mappedCodes.includes(code), `${code} is declared against the acceptance and reaches the admin unmapped`);
    }
  });

  it("maps every code the decline declares", () => {
    const declared = declaredCodes(ABLEHNEN_OPERATION);

    assert.deepEqual(declared, ["REQ-BEWERBUNG-001"]);
    for (const code of declared) {
      assert.ok(mappedCodes.includes(code), `${code} is declared against the decline and reaches the admin unmapped`);
    }
  });

  /* Pinned through the SERVICES, not the operation strings: `REQ-ENTER-005` writes its operations
     as a parenthesised literal, which `refusalRegister.ts`'s single-literal parse reads as none. */
  it("maps the entry rules the acceptance reuses", () => {
    for (const service of REUSED_SERVICES) {
      assert.ok(ADMIN_ROUTER.includes(`${service}(`), `the acceptance no longer calls ${service}, so its codes cannot reach it`);
    }

    for (const code of REUSED_ENTRY_CODES) {
      const rule = DECLARED_RULES.find((declared) => declared.code === code);

      assert.ok(rule, `${code} is declared by no rule at all`);
      assert.ok(
        REUSED_SERVICES.some((service) => rule.source.includes(service)),
        `${code} is implemented by neither service the acceptance calls`,
      );
      assert.ok(mappedCodes.includes(code), `${code} can refuse an acceptance and the mapper does not answer it`);
    }
  });

  it("answers the Kürzel collision with the repair rather than the generic conflict", () => {
    assert.ok(EXCEPTION_HANDLERS.includes('HTTP_409_CONFLICT, "DB-COMMON-002"'), "a duplicate key no longer arrives as a 409");
    assert.match(MAPPER, /case "DB-COMMON-002":/, "the Kürzel collision falls through to the generic conflict message");
    assert.match(MAPPER, /Kürzel des anderen Teams/, "the collision names no way out of itself");
  });

  /* The register above pins that the code is answered; this pins WHAT it answers. Which of the
     school's fields fails never reaches the wire, so the message names the candidates, and no edit
     path turns the application into a shape acceptance takes. */
  it("names the school's own fields, and a repair that exists, when no club can be created", () => {
    assert.match(MAPPER, /case "REQ-BEWERBUNG-003":/, "a school no club can be created from falls through to the generic conflict");
    assert.match(
      MAPPER,
      /Team-Name, vollständiger Name, Kürzel, Adresse oder Website/,
      "the refusal names no field an administrator could look at",
    );
    assert.match(MAPPER, /Lehne die Bewerbung ab und lege das Team/, "the refusal offers no route the admin surface actually has");
  });

  /* Found through the SERVICE rather than by its number, which is the backend's to assign. A code
     the mapper misses falls through to the 409 fallback (`.claude/rules/cross-surface.md`). */
  it("answers the acceptance's refusal over an unconfirmed seat", () => {
    const rule = DECLARED_RULES.find((declared) => declared.source.includes("find_unconfirmed_kontakte_refusal"));

    assert.ok(rule, "no rule is implemented by find_unconfirmed_kontakte_refusal");
    assert.ok(rule.operations.includes(ANNEHMEN_OPERATION), `${rule.code} is not declared against the acceptance`);
    assert.ok(mappedCodes.includes(rule.code), `${rule.code} refuses an acceptance over an unconfirmed seat and the mapper does not answer it`);
  });

  it("maps no code the backend does not declare at all", () => {
    for (const code of mappedCodes) {
      assert.ok(
        DECLARED_RULES.some((rule) => rule.code === code),
        `${code} is mapped here and declared by no rule`,
      );
    }
  });

  /* `REQ-ENTER-004` guards a group MOVE, which no acceptance performs: a row is created here, never
     moved. Reaching it from this action would refuse an acceptance over fixtures it does not touch. */
  it("leaves the group move's own refusal on the move", () => {
    assert.ok(!mappedCodes.includes("REQ-ENTER-004"), "the triage answers the group move's refusal");
    assert.ok(!declaredCodes(ANNEHMEN_OPERATION).includes("REQ-ENTER-004"), "the register moved the lock onto the acceptance");
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
  it("invalidates nothing on a decline, and says why", () => {
    assert.ok(!ABLEHNEN_ACTION.includes("updateTag("), "the decline clears a cached read its endpoint does not move");
    assert.match(ABLEHNEN_ACTION, /Nothing to invalidate/, "the decline no longer says why it invalidates nothing");
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

/** One branch with its comments dropped: only a rendered string is German a reader ever sees. */
const withoutComments = (source: string): string => source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

/**
 * Every branch answering one refusal code, cut from the code's own literal to the next branch. Read
 * across the mappers rather than out of one: what a code means is the backend's, and two surfaces
 * naming that meaning differently is what this looks for.
 */
function renderingsOf(code: string, sources: readonly { where: string; source: string }[]): { where: string; german: string }[] {
  return sources.flatMap(({ where, source }) =>
    source
      .split(`"${code}"`)
      .slice(1)
      // To the next branch: a `case` label, another `if` on the same field, or the mapper's own close.
      .map((tail, index) => ({
        where: `${where} #${String(index + 1)}`,
        german: withoutComments(tail.split(/case "|serverErrorCode ===|default:|\n\}/)[0] ?? ""),
      })),
  );
}

const RETIRED_RENDERINGS = renderingsOf("REQ-ENTER-005", [
  { where: "the triage", source: MAPPER },
  { where: "the club editor", source: TEAMS_ACTIONS },
]);

/** The German inside one branch: a quoted literal holding a space, which no identifier beside it is. */
const sentencesOf = (rendering: string): string[] => [...rendering.matchAll(/"([^"]*\s[^"]*)"/g)].map((match) => match[1]!);

/** Every determiner a neuter noun takes. One in front of „Team“ that is not here is the disagreement. */
const NEUTER_DETERMINERS = ["Das", "das", "Dieses", "dieses", "Ein", "ein", "Kein", "kein", "Sein", "sein", "Jedes", "jedes"];

/**
 * Masculine, because that is the wrong guess „Team“ invites: „Verein“ and „Club“ are masculine and
 * carry the same meaning. Feminine is left out — „Bewerbung“ and „Saison“ stand in these sentences too.
 */
const NOT_A_TEAM = /(?<!\p{L})(ihn|ihm|er)(?!\p{L})/gu;

/**
 * The words ending in `-st` that address nobody. Every other one is a second-person indicative, and a
 * repair is written as an imperative (`docs/frontend/spec.md` §1.12).
 */
const NOT_AN_INDICATIVE = ["ist", "erst", "selbst", "sonst", "zunächst", "fast", "meist", "Frist", "Rest"];

describe("the German one refusal code is given", () => {
  /* First: a cut that stopped matching leaves every string below empty, and an empty string carries
     no banned word, so the case below would pass over nothing at all. */
  it("finds every rendering of the retired-club refusal before judging one", () => {
    assert.equal(
      RETIRED_RENDERINGS.length,
      3,
      `REQ-ENTER-005 is rendered in ${String(RETIRED_RENDERINGS.length)} branches, not the three this case reads`,
    );
    for (const { where, german } of RETIRED_RENDERINGS) {
      assert.match(german, /reason:|return\s+"|\n\s+"/, `${where} was cut to something holding no message`);
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
    for (const { where, german } of RETIRED_RENDERINGS) {
      const sentences = sentencesOf(german);
      assert.notEqual(sentences.length, 0, `${where} was cut to something holding no rendered sentence`);

      for (const sentence of sentences) {
        for (const [, determiner] of sentence.matchAll(/(\p{L}+)\s+(?:\p{L}+\s+)?Team(?![-\p{L}])/gu)) {
          assert.ok(NEUTER_DETERMINERS.includes(determiner!), `${where} puts „${determiner!}“ in front of the neuter „Team“`);
        }

        // The club is what a repair reactivates, so the pronoun standing for it is the neuter „es“.
        for (const [, object] of sentence.matchAll(/Reaktiviere\s+(\p{L}+)/gu)) {
          assert.equal(object, "es", `${where} reactivates „${object!}“, and a „Team“ is reactivated as „es“`);
        }

        for (const [pronoun] of sentence.matchAll(NOT_A_TEAM)) {
          assert.fail(`${where} stands „${pronoun}“ in for a „Team“, which is neuter`);
        }

        for (const [word] of sentence.matchAll(/(?<!\p{L})(\p{L}+st)(?!\p{L})/gu)) {
          assert.ok(NOT_AN_INDICATIVE.includes(word), `${where} says „${word}“ where a repair addresses the reader as an imperative`);
        }
      }
    }
  });
});

describe("the decline's bound", () => {
  /* Mirrored, never recalled: past the backend's ceiling the API answers a bare `REQ-VAL-001` with no
     field detail, so nothing would mark the box. */
  it("caps the reason at the number the backend states", () => {
    const backend = /^BEWERBUNG_GRUND_MAX_LENGTH: Final = (\d+)$/m.exec(BOUNDS)?.[1] ?? "";
    const frontend = /^export const BEWERBUNG_GRUND_MAX_LENGTH = (\d+);$/m.exec(CONSTANTS)?.[1] ?? "";

    assert.notEqual(backend, "", "the backend no longer states the bound under that name");
    assert.equal(frontend, backend, "the frontend mirror disagrees with the backend's bound");
    assert.ok(SCHEMAS.includes("BEWERBUNG_GRUND_MAX_LENGTH"), "the payload schema stopped reading the mirrored bound");
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

  /* The same rule at the control, which is the half a schema cannot reach: the button is what stops
     a press, and `docs/frontend/spec.md` I18 makes it the schema's rule rather than a second one. */
  it("disables the decline on the value the schema judges", () => {
    const panel = PANELS.find((candidate) => candidate.name === "AdminBewerbungAblehnenSection");

    assert.ok(panel, "the decline panel is no longer where this case reads it");
    assert.ok(panel.source.includes("const trimmedGrund = grund.trim();"), "the panel judges a string other than the one it measures");
    assert.ok(panel.source.includes('const isEmpty = trimmedGrund === "";'), "the decline arms on a reason the schema refuses");
    // The raw value is longer than the trimmed one, so a raw gate refuses a reason the schema and
    // the backend both take, and the reader is told to shorten what is already inside the cap.
    assert.ok(
      panel.source.includes("const isTooLong = trimmedGrund.length > BEWERBUNG_GRUND_MAX_LENGTH;"),
      "the decline is refused at a length the write accepts",
    );
    assert.match(panel.source, /isDisabled=\{isDeclining \|\| isEmpty \|\| isTooLong\}/, "the button no longer reads that gate");
  });

  /* A reason at the cap with padding around it: the schema takes it, so the panel that measures the
     raw string disables the button and counts past the cap over a reason the school would have read. */
  it("takes a reason whose padding is all that carries it past the cap", () => {
    const padded = `  ${"a".repeat(BEWERBUNG_GRUND_MAX_LENGTH)}  `;
    const parsed = FLAblehnenBewerbungPayloadSchema.safeParse({ id: "68d0f2a4c1e2b3a4d5e6f708", grund: padded });

    assert.equal(parsed.success, true, "a reason inside the cap once trimmed is refused by the schema");
    assert.equal(parsed.data?.grund.length, BEWERBUNG_GRUND_MAX_LENGTH);
  });

  /* What the reader is shown about that same string. A counter over a cap the write does not enforce
     reads as a refusal, and a preview holding padding the write drops promises a message nobody sends. */
  it("counts and previews the reason the write carries", () => {
    const panel = PANELS.find((candidate) => candidate.name === "AdminBewerbungAblehnenSection");

    assert.ok(panel, "the decline panel is no longer where this case reads it");
    assert.ok(
      panel.source.includes("{String(trimmedGrund.length)} von {String(BEWERBUNG_GRUND_MAX_LENGTH)} Zeichen"),
      "the counter measures a string the schema does not",
    );
    assert.ok(
      panel.source.includes("Diese Begründung geht so an die Kontaktpersonen: „{trimmedGrund}“"),
      "the confirmation previews a reason other than the one that goes out",
    );
  });
});

describe("the readout's count", () => {
  const kopf = sliceBetween(STRIP, "panel.header()", "panel.body()");

  /* In the header beside the heading rather than at the top of the body, where it read as the first
     of the seat rows below it. */
  it("stands in the section's header", () => {
    assert.ok(kopf !== "", "the strip's header is no longer where this case cuts it");
    assert.match(kopf, /von \{String\(staende\.length\)\} bestätigt/, "the count is no longer beside the heading");
    assert.ok(!sliceBetween(STRIP, "panel.body()", "muted-hint").includes("bestätigt"), "the body carries a second count");
  });

  /* One tone for the summary and another for what it summarises: at `warning` it was the same chip
     as an outstanding SEAT, three rows of which sit directly beneath it. */
  it("is toned apart from an outstanding seat's own chip", () => {
    const ausstehend = /ausstehend: "([^"]*)"/.exec(STRIP)?.[1] ?? "";
    // Read back from the count's own text rather than out of the header, so moving the chip cannot
    // leave this case judging an empty slice.
    const gezogen = STRIP.lastIndexOf("className=", STRIP.indexOf("{String(bestaetigt)} von"));
    const chip = STRIP.slice(gezogen, STRIP.indexOf("{String(bestaetigt)} von"));

    assert.notEqual(ausstehend, "", "the seat tints are no longer where this case reads them");
    assert.notEqual(gezogen, -1, "the count is no longer rendered where this case reads it");
    assert.ok(!chip.includes(ausstehend), `the count wears an outstanding seat's own tint, ${ausstehend}`);
    // The table as well as the literal: reaching into the seats' own tints is how the two come back
    // together under a rename that leaves this file's regex above still matching.
    assert.ok(!chip.includes("STAND_TINT"), "the count is tinted out of the seat rows' own table");
    assert.match(chip, /ZAEHLER_TINT/, "the count no longer takes a tone of its own");
    assert.match(STRIP, /ZAEHLER_TINT = \{ offen: "bg-brand\/10/, "the count no longer takes the brand's tone while seats are outstanding");
  });
});

describe("the queue's columns", () => {
  /* One rule on the table rather than a class per cell: HeroUI's `Table.Column` takes no alignment
     prop, so nothing else makes eight columns read from one edge. */
  it("reads from one edge, with the controls the single exception", () => {
    assert.match(
      TABLE,
      /className="min-w-7xl table-fixed text-left"/,
      "the table declares no alignment, so each cell keeps whatever it inherits",
    );

    const geendet = [...TABLE.matchAll(/text-right/g)];

    assert.equal(geendet.length, 1, `expected the Aktionen column alone to end right, found ${String(geendet.length)}`);
    assert.match(TABLE.slice(geendet[0]!.index), /^text-right[\s\S]{0,120}Aktionen/, "a column other than Aktionen is ended right");
  });

  /* A pill that cannot break overruns a column too narrow for it instead of wrapping inside it, so
     the widths are read off the pills rather than off the headings, which may wrap. */
  it("never lets a pill break across two lines", () => {
    assert.match(LABEL_BADGE, /\bwhitespace-nowrap\b/, "a pill breaks across two lines, where it reads as two pills");
  });

  /* A calendar date is fixed-format: its column is sized to it, and a clipped one is another date.
     Truncating it was the repair for a column too narrow, which is the wrong end of the problem. */
  it("truncates the names and never the date", () => {
    // The LAST rendering: the phone card above the table draws the same date, and it is the table's
    // fixed column that a truncation would be hiding.
    const eingereicht = TABLE.lastIndexOf("{formatSpielDatum(bewerbung.eingereicht_am)}");

    assert.notEqual(eingereicht, -1, "the queue no longer renders the submission date where this case reads it");
    assert.doesNotMatch(TABLE.slice(eingereicht - 120, eingereicht), /truncate/, "the submission date is clipped rather than given its width");
    assert.match(TABLE, /min-w-0 truncate[^"]*">\{bewerbung\.schule\.full_name\}/, "the school's full name no longer truncates at its column");
  });
});

describe("the Zusage where the write would be refused", () => {
  /* Withheld, the section sent the administrator looking for a decision the page still held. It
     stands and closes its own control instead (my rule, 2026-09-04). */
  it("stands whatever would refuse it, rather than being replaced by a closure", () => {
    assert.match(
      VIEW,
      /\{isOpen && \( <AdminBewerbungAnnehmenSection/,
      "the acceptance is offered on some narrower condition than an open application",
    );
    assert.ok(!VIEW.includes("<Callout"), "the page still puts a closure where the acceptance belongs");
    assert.ok(VIEW.includes("hindernis={hindernis}"), "the panel is handed no reason, so its control cannot say why it is closed");
  });

  /* The reason is readable without a pointer: a control closed by a tooltip alone is closed for
     reasons only a mouse can read. */
  it("closes its control on that reason and renders the reason beside it", () => {
    const panel = PANELS.find((candidate) => candidate.name === "AdminBewerbungAnnehmenSection");

    assert.ok(panel, "the acceptance panel is no longer where this case reads it");
    assert.ok(panel.source.includes("isDisabled={isAccepting || grund !== null}"), "the acceptance arms over a state its endpoint refuses");
    assert.match(
      panel.source,
      /<Hint mode="inline" describes=\{ZUSAGE_BUTTON_HINT_ID\} text=\{grund\} \/>/,
      "the reason no longer reaches the page as text under the control",
    );
    assert.ok(
      panel.source.includes("aria-describedby={!isAccepting && grund !== null ? ZUSAGE_BUTTON_HINT_ID : undefined}"),
      "the closed control points at no sentence, so a screen reader meets a disabled button with no reason",
    );
  });
});

describe("which irreversibility the triage claims", () => {
  /* `docs/frontend/spec.md` §1.3 splits the two sentences on one mechanical test: the second belongs
     to a write whose transaction empties the log rows it filed. Neither decision redacts, so the
     pre-image survives both and the FIRST sentence is theirs. */
  it("takes the sentence for a write the action log outlives", () => {
    assert.match(RECORDING, /def build_redaction_update/, "the redaction this test turns on is gone");
    assert.ok(!ADMIN_ROUTER.includes("build_redaction_update"), "the triage now redacts, so the sentence below is the wrong one");

    for (const panel of PANELS) {
      assert.match(panel.source, /Es gibt in der Verwaltung keinen Weg zurück\./, `${panel.name} drops the irreversibility sentence`);
      assert.ok(
        !panel.source.includes("Zurückholen lässt sich das nicht"),
        `${panel.name} claims the log is emptied, and no triage write empties one`,
      );
    }
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

    // The exact count rather than a floor: each of the two is judged by its own rule below, and a
    // third reader is a path whose side of the write nobody has decided.
    assert.equal(reads.length, 2, `expected two club-name readers, found ${String(reads.length)}`);

    const nachDemSchreiben = reads.find((read) => read.holder === "notifyBewerbung");
    assert.ok(nachDemSchreiben?.guarded, "a failed club read reports a committed decision as one that did not happen");

    const vorDemMint = reads.find((read) => read.holder === "einwilligungErneutSendenAction");
    assert.ok(vorDemMint, "the re-send reads the club's name outside the action that mints, where a throw costs a link");
    assert.ok(
      vorDemMint.at < ACTIONS.indexOf("await erneutSendenEinwilligung("),
      "the re-send reads the club's name after spending the seat's link on a message it may not be able to compose",
    );
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
    const felder = (block: string) => [...block.matchAll(/^ {2}(\w+)\??:/gm)].map((treffer) => treffer[1]!);
    const zusage = felder(sliceBetween(EMAIL, "export interface BewerbungZusageData", "\n}"));
    const absage = felder(sliceBetween(EMAIL, "export interface BewerbungAbsageData", "\n}"));

    // Anti-vacuity: a moved interface would leave both lists empty and this assertion true of nothing.
    assert.ok(zusage.length > 0 && absage.length > 0, "neither message's field list was found, so nothing was compared");

    // The BUILDER's own argument, never the whole action: `gruppe` is also a key of the sentence
    // `describeAufnahme` composes, so a search over the action passes a mail that dropped it.
    const zusageAufruf = sliceBetween(ACTIONS, "buildBewerbungZusageEmail({", "})");
    const absageAufruf = sliceBetween(ACTIONS, "buildBewerbungAbsageEmail({", "})");

    assert.ok(zusageAufruf !== "" && absageAufruf !== "", "one of the two mail builders is no longer called with an object literal");

    // Collected rather than asserted one at a time: a per-field assertion stops at the first gap, so
    // a second one is invisible until the first is closed.
    const ungefuellt = [
      ...zusage.map((feld) => [feld, zusageAufruf, "annehmen"] as const),
      ...absage.map((feld) => [feld, absageAufruf, "ablehnen"] as const),
    ]
      .filter(([feld, aufruf]) => !new RegExp(`\\b${feld}:`).test(aufruf))
      .map(([feld, , wo]) => `${wo}/${feld}`)
      .sort();

    assert.deepEqual(ungefuellt, [], `these declared message fields reach no call site: ${ungefuellt.join(", ")}`);
  });
});

describe("the re-sent confirmation link", () => {
  /* Before the comparison below: a test looping over an empty declared list maps nothing and stays
     green, and this endpoint's operation string is the backend's to spell. */
  it("finds rules declared against the endpoint it addresses", () => {
    assert.ok(declaredCodes(ERNEUT_OPERATION).length > 0, `no rule is declared against ${ERNEUT_OPERATION}`);
  });

  it("maps every code the re-send declares", () => {
    for (const code of declaredCodes(ERNEUT_OPERATION)) {
      assert.ok(erneutCodes.includes(code), `${code} is declared against the re-send and reaches the admin unmapped`);
    }
  });

  it("maps no code the backend does not declare at all", () => {
    for (const code of erneutCodes) {
      assert.ok(
        DECLARED_RULES.some((rule) => rule.code === code),
        `${code} is mapped by the re-send and declared by no rule`,
      );
    }
  });

  /* Both the application and the seat travel in the path, and the tier is `admin`: over-declaring a
     tier fails loudly, while under-declaring one sends an admin write out unattributed. */
  it("addresses its own endpoint, with the seat in the path", () => {
    assert.match(MUTATIONS, /`\/bewerbungen\/\$\{id\}\/einwilligung\/\$\{rolle\}\/erneut`/, "the re-send no longer addresses its own endpoint");
    assert.match(
      MUTATIONS,
      /erneut`,\s*FLBewerbungEinwilligungErneutResponseSchema,\s*\{\s*method: "POST",\s*authType: "admin",/,
      "the re-send is sent as something other than an admin-tier POST",
    );
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
      ['person.email === ""', "KEINE_ADRESSE"],
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
    const gelesen = (name: string): string =>
      sentencesOf(erneutSatz(name))
        .join(" ")
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, " ")
        .trim();

    const saetze = ["BEWERBUNG_WEG", "SITZ_LEER", "KEINE_ADRESSE", "KEIN_TEAM", "KEIN_LINK_VERSCHICKT"].map(gelesen);

    assert.ok(
      saetze.every((satz) => satz !== ""),
      `a re-send sentence reaches no literal at all: ${saetze.join(" | ")}`,
    );
    assert.equal(new Set(saetze).size, saetze.length, "two of the re-send's answers say the same thing");
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

    const kosten = erneutSatz("KEIN_LINK_VERSCHICKT");

    assert.match(kosten, /Der alte Link gilt nicht mehr/, "the failure does not say the previous link is spent");
    assert.match(kosten, /Versuche es noch einmal/, "the failure names no way out");
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

  /* The one thing on this path that must not reach a second reader. A toast, a log line or a returned
     sentence carrying it hands the seat's credential to whoever can see the screen or the stream. */
  it("spells the minted token into the link and into nothing else", () => {
    const link = "bestaetigungsLink(token)";

    assert.ok(ACTIONS.includes(link), "the confirmation link is no longer built where this case reads it");
    assert.ok(!ACTIONS.includes("${token}"), "the minted token is spelled into a string of this module's own");

    for (const [aufruf] of `${ERNEUT_SENDER}${ERNEUT_ACTION}`.matchAll(/logger\.\w+\([\s\S]*?\n\s{4}\}\);/g)) {
      assert.ok(!aufruf.includes("token"), "a log line on the re-send's path names the token");
    }
  });

  /* This moves the application's own confirmation block and its deadline, and no cached read holds an
     application: both triage reads are uncached because an application is personal data. */
  it("invalidates nothing, and says why", () => {
    assert.ok(!ERNEUT_ACTION.includes("updateTag("), "the re-send clears a cached read its endpoint does not move");
    assert.match(ERNEUT_ACTION, /Nothing to invalidate/, "the re-send no longer says why it invalidates nothing");
  });
});
