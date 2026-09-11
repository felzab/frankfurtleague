import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { APIBadStatusError } from "@/core/errors.ts";
import { declaredCodes, sliceBetween } from "@/shared/testing/refusalRegister.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");

/** The one endpoint both write paths send, the dry run included, so one operation carries every refusal either can draw. */
const PATCH_OPERATION = "PATCH /spiele/{spiel_id}";

const DECLARED_CODES = declaredCodes(PATCH_OPERATION);

/** The same set restated, so a code retired from the register fails here rather than leaving a dead arm behind. */
const PATCH_CODES = [
  "REQ-BOOKING-001",
  "REQ-CLASH-001",
  "REQ-DATE-001",
  "REQ-ELIGIBILITY-001",
  "REQ-ELIGIBILITY-002",
  "REQ-RESULT-001",
  "REQ-SPIELTAG-001",
  "REQ-SPIELTAG-002",
  "REQ-STATE-002",
  "REQ-STATE-003",
  "REQ-WIRING-001",
  "REQ-WIRING-002",
  "REQ-WIRING-003",
];

/* Read per slice rather than over the file: both write paths repeat the mapper's call, and a search
   over the whole source is satisfied by whichever of the three happens to carry the code. */
const SPIEL_MAP = sliceBetween(ACTIONS, "function mapSpielRefusal", "export async function patchAdminSpielDataAction");

/**
 * What the shared fallback answers for one code. Asked rather than read as source text: it is an
 * ordinary exported function, and its answer is what the admin gets.
 */
function sharedAnswer(serverErrorCode: string): string {
  const refusal = new APIBadStatusError({
    message: "conflict",
    url: "http://backend:8000/api/v0/spiele/x",
    endpoint: "/spiele/{spiel_id}",
    traceId: "ab".repeat(16),
    statusCode: 409,
    serverErrorCode,
  });

  return toActionErrorResult(refusal).error;
}

/**
 * The sentence `fl_frontend/src/shared/utils/actionError.ts` gives a 409 no arm claimed, asked for
 * with a code no rule declares rather than restated, so a rewording of it costs this file nothing.
 */
const FALLBACK = sharedAnswer("REQ-NOTHING-000");

describe("the match editor's refusals against the backend's register", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/shared/testing/refusalRegister.ts :: sliceBetween`). */
  it("cuts the mapper out of the file before reading it", () => {
    assert.ok(SPIEL_MAP.includes("serverErrorCode"), "the mapper's arms are outside its slice");
    assert.ok(!SPIEL_MAP.includes("patchAdminSpielData(validated.data)"), "the mapper's slice runs on into the save");
  });

  it("finds every rule the match endpoint declares", () => {
    assert.deepEqual(DECLARED_CODES, PATCH_CODES);
  });

  /* Pinned before the cases below read it: an unmapped code is told apart from a mapped one by this
     sentence alone, and an empty one would make every case pass for a code nobody answers. */
  it("keeps a sentence for the refusals nothing claims", () => {
    assert.match(FALLBACK, /Konflikt/);
  });

  /* Two sites answer them: the slice's own mapper, and the shared fallback behind it. A code neither
     claims reaches the admin as the sentence above, which is false for every rule declared here. */
  for (const code of DECLARED_CODES) {
    it(`${code} reaches the admin as its own refusal`, () => {
      const shared = sharedAnswer(code);
      const answered = SPIEL_MAP.includes(`serverErrorCode === "${code}"`) || (shared !== "" && shared !== FALLBACK);

      assert.ok(answered, `${code} tells the admin an equivalent entry already exists`);
    });
  }
});

describe("the match edit's refusals when the undo replays it", () => {
  const UNDO_ROUTE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin", "spiele", "undo", "route.ts"), "utf8");

  /** One row of the route's replay table, which is a literal keyed by code. */
  const replayRow = (code: string): string => new RegExp(`"${code}":\\s*"([^"]*)"`).exec(UNDO_ROUTE)?.[1] ?? "";

  it("adds the outcome sentence once, outside the rows", () => {
    assert.ok(UNDO_ROUTE.includes('const CHANGE_STANDS = "Die Änderung steht weiterhin.";'), "the whole-change outcome is gone");
    // Unconditional, which is what the one transaction buys: a refusal on any entry leaves the whole
    // change standing rather than the part a stopped replay had already put back.
    assert.ok(UNDO_ROUTE.includes("${refusal} ${CHANGE_STANDS}"), "a refusal no longer closes with the outcome");
  });

  /* The route's own rows, never `sharedAnswer`'s: eight of these codes reach a named arm there,
     whose German is written for a save — one of them says to delete the goals the undo is putting back. */
  for (const code of DECLARED_CODES) {
    it(`${code} reaches the admin in German when the edit is undone`, () => {
      const row = replayRow(code);

      assert.notEqual(row, "", `${code} falls through to the generic conflict message when the edit is undone`);
      // The route joins the row to the outcome with a space, so a row without its own stop runs the two sentences together.
      assert.ok(row.endsWith("."), `${code}'s replay row does not close its sentence`);
      assert.ok(!row.includes("Die Änderung steht weiterhin"), `${code}'s row states the outcome the route already adds`);
      /* One replay carries several fixtures, so a row pointing at one of them is wrong on the rest.
         Case-insensitive: every row is a sentence, and the singular a row would open with is capital. */
      assert.doesNotMatch(row, /\b(?:dieses|diesem|das)\s+Spiels?\b/i, `${code}'s row points at a single fixture the replay may not have`);
    });
  }
});

/**
 * Each action's own source, comments blanked and ended at the NEXT declaration of any kind, so a
 * helper standing between two exports cannot answer for the one above it. Blanking can swallow a
 * real call; it cannot invent one.
 */
const BARE_ACTIONS = ACTIONS.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " ")).replace(/^[ \t]*\/\/[^\n]*$/gm, "");
const DECLARATIONS = [...BARE_ACTIONS.matchAll(/^(export )?(?:async )?function (\w+)/gm)];
const ACTION_BODIES = new Map<string, string>(
  DECLARATIONS.flatMap((match, index): [string, string][] =>
    match[1] === undefined ? [] : [[match[2] ?? "", BARE_ACTIONS.slice(match.index, DECLARATIONS[index + 1]?.index)]],
  ),
);

/** The mutation callback's own top level: a call one block deeper runs on a branch rather than on every path out. */
const TOP_LEVEL_REFRESH = /^ {4}refresh\(\);$/m;

/** The write this slice exports. A new action fails the sweep below until it is placed. */
const WRITE_ACTIONS = ["patchAdminSpielDataAction"];

/** The dry run, which moves nothing and so owes the page nothing. */
const READ_ONLY_ACTIONS = ["previewAdminSpielDataAction"];

describe("the refresh a write owes the list the admin is looking at", () => {
  it("places every action the slice exports, each in the callback the case below reads", () => {
    assert.deepEqual(
      [...ACTION_BODIES.keys()],
      [...WRITE_ACTIONS, ...READ_ONLY_ACTIONS],
      "an action arrived or left without being placed as a write or a dry run",
    );
    for (const name of [...WRITE_ACTIONS, ...READ_ONLY_ACTIONS]) {
      assert.ok(
        ACTION_BODIES.get(name)?.includes(`\n  return runAdminMutation("${name}", async () => {\n`),
        `${name} opens some other callback, so the indentation the next case reads means nothing`,
      );
    }
  });

  it("refreshes on the save, the editor's own fixture read being uncached", () => {
    for (const name of WRITE_ACTIONS) {
      const body = ACTION_BODIES.get(name) ?? "";
      const refreshAt = body.search(TOP_LEVEL_REFRESH);
      assert.notEqual(refreshAt, -1, `${name} writes and leaves the admin's page standing`);
      assert.ok(refreshAt < body.indexOf("success: true"), `${name}'s success return does not stand after a refresh`);
    }
  });

  it("leaves the dry run alone, which would re-render the editor on every keystroke", () => {
    for (const name of READ_ONLY_ACTIONS) {
      assert.doesNotMatch(ACTION_BODIES.get(name) ?? "", /^\s+refresh\(\);$/m, `${name} refreshes a page nothing it did has moved`);
    }
  });
});
