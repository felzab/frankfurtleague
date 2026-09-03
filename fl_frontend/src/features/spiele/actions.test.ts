import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { APIBadStatusError } from "@/core/errors.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import { declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";

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
    correlationId: "ab".repeat(16),
    statusCode: 409,
    serverErrorCode,
  });

  return toActionErrorResult(refusal).error ?? "";
}

/**
 * The sentence `fl_frontend/src/shared/utils/actionError.ts` gives a 409 no arm claimed, asked for
 * with a code no rule declares rather than restated, so a rewording of it costs this file nothing.
 */
const FALLBACK = sharedAnswer("REQ-NOTHING-000");

describe("the match editor's refusals against the backend's register", () => {
  /* First, so a boundary that stopped matching fails here (`fl_frontend/src/core/refusalRegister.ts :: sliceBetween`). */
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
