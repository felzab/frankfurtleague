import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import ts from "typescript";

import { DECLARED_RULES, declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";
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

/** The confirmation panels, read as text: what they PROMISE is the claim these assertions hold. */
const PANELS = ["AdminBewerbungAnnehmenSection", "AdminBewerbungAblehnenSection"].map((name) => ({
  name: name,
  source: readFileSync(path.resolve(import.meta.dirname, "components", "forms", `${name}.tsx`), "utf8").replace(/\s+/g, " "),
}));

/** The club editor's own mapper, which answers `REQ-ENTER-005` about the same stored state this one does. */
const TEAMS_ACTIONS = readFileSync(path.resolve(import.meta.dirname, "..", "teams", "actions.ts"), "utf8");

/** The backend module whose absence from the triage decides which sentence they take. */
const RECORDING = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "core", "recording.py"), "utf8");

/** The two decision messages, read for the fields their call sites in `actions.ts` have to fill. */
const EMAIL = readFileSync(path.resolve(REPO_ROOT, "fl_frontend", "src", "core", "bewerbungEmail.ts"), "utf8");

const ANNEHMEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/annehmen";
const ABLEHNEN_OPERATION = "POST /bewerbungen/{bewerbung_id}/ablehnen";
/** Where the entry rules acceptance REUSES are declared: they belong to the season's boundary, not the triage's. */
const ENTRY_OPERATION = "POST /teams/{team_id}/saisons";

/** The season's entry services, which `annehmen_bewerbung` calls rather than restating. */
const REUSED_SERVICES = ["find_entry_refusal", "find_club_entry_refusal"];

/** The entry rules those services implement, and so the ones an acceptance can answer. */
const REUSED_ENTRY_CODES = ["REQ-ENTER-001", "REQ-ENTER-002", "REQ-ENTER-003", "REQ-ENTER-005"];

const MAPPER = sliceBetween(ACTIONS, "function mapTriageRefusal", "async function resolveBewerbungTeamName");
const ANNEHMEN_ACTION = sliceBetween(ACTIONS, "export async function annehmenBewerbungAction", "export async function ablehnenBewerbungAction");
/* The decline is the last declaration in the module, so its slice runs to the end of the file. */
const ABLEHNEN_ACTION = sliceBetween(ACTIONS, "export async function ablehnenBewerbungAction", null);
/** Everything both decisions run AFTER their write has committed. */
const NOTIFY = sliceBetween(ACTIONS, "async function notifyBewerbung", "export async function annehmenBewerbungAction");

/** Every code the mapper answers, read off its switch. */
const mappedCodes = [...MAPPER.matchAll(/case "(REQ-[A-Z]+-\d+)"/g)].map((match) => match[1]!);

describe("the slices these assertions read", () => {
  /* First, because a boundary string that stopped matching leaves the slices empty and every
     assertion over them would then fail for something that is not the defect. */
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

  /* `REQ-ENTER-005` is `inactive_since`, which every admin surface calls „stillgelegt“. „Verlassen“
     is an `austritt` (`docs/glossary.md`), another record on another page. */
  it("calls a retired club stillgelegt in every branch that answers it", () => {
    for (const { where, german } of RETIRED_RENDERINGS) {
      assert.ok(german.includes("stillgelegt"), `${where} gives REQ-ENTER-005 a state word other than „stillgelegt“`);
      assert.match(german, /\bTeam\b/, `${where} names the club as something other than a „Team“`);

      for (const banned of ["usgeschieden", "verlassen", "Verein"]) {
        assert.ok(!german.includes(banned), `${where} says „${banned}“ of a retired club, which is an austritt and another record`);
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
  /* The club's name is read AFTER the write commits and the tags are set. Thrown out of the action,
     that read turns a decision that stands into a reported failure, and the retry it invites is
     refused as already taken (`REQ-BEWERBUNG-001`). */
  it("reads the club's name where a failure cannot reach the decision's result", () => {
    const file = path.resolve(import.meta.dirname, "actions.ts");
    const source = ts.createSourceFile(file, ACTIONS, ts.ScriptTarget.Latest, true);
    let reads = 0;
    let guarded = 0;

    source.forEachChild(function walk(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "resolveBewerbungTeamName") {
        reads += 1;
        for (let ancestor: ts.Node | undefined = node; ancestor?.parent; ancestor = ancestor.parent) {
          const holder: ts.Node = ancestor.parent;

          // The TRY block specifically: the same call standing in the catch would be unguarded again.
          if (ts.isTryStatement(holder) && holder.tryBlock === ancestor && holder.catchClause) guarded += 1;
        }
      }
      node.forEachChild(walk);
    });

    assert.equal(reads, 1, "the club's name is read somewhere other than the one place this test reads");
    assert.equal(guarded, 1, "a failed club read reports a committed decision as a write that did not happen");
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
