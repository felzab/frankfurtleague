import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  FLBewerbungKaderPayloadSchema,
  FLBewerbungKontaktpersonPayloadSchema,
  FLBewerbungSchulePayloadSchema,
  FLBewerbungTrikotPayloadSchema,
} from "./schemas.ts";

import type { ZodType } from "zod";

const DOCUMENT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "fl_backend", "openapi.json");

/**
 * Discovered from the backend's own document rather than listed here: a ceiling this file names is one somebody
 * remembered, and the ceiling added next is the one nobody adds. The public endpoint answers a length refusal
 * with a bare `REQ-VAL-001` and no field detail, so an unmirrored bound is refused with nothing marking the box.
 */
const MIRRORS: Record<string, ZodType> = {
  FLBewerbungSchulePayload: FLBewerbungSchulePayloadSchema,
  FLBewerbungTrikotPayload: FLBewerbungTrikotPayloadSchema,
  FLBewerbungKaderPayload: FLBewerbungKaderPayloadSchema,
  FLBewerbungKontaktpersonPayload: FLBewerbungKontaktpersonPayloadSchema,
};

type Capped = { component: string; field: string; over: unknown };

function cappedFields(): Capped[] {
  const document = JSON.parse(readFileSync(DOCUMENT, "utf8")) as {
    components: { schemas: Record<string, { properties?: Record<string, Record<string, unknown>> }> };
  };
  const found: Capped[] = [];

  for (const component of Object.keys(MIRRORS)) {
    const properties = document.components.schemas[component]?.properties ?? {};
    for (const [field, spec] of Object.entries(properties)) {
      // One past the ceiling, in the shape the field takes: a letters-only name and a plain count both work.
      if (typeof spec.maxLength === "number") found.push({ component, field, over: "a".repeat(spec.maxLength + 1) });
      else if (typeof spec.maximum === "number") found.push({ component, field, over: spec.maximum + 1 });
    }
  }

  return found;
}

const capped = cappedFields();

describe("every ceiling the backend publishes is one the mirror refuses", () => {
  it("finds the capped fields to judge", () => {
    // Anti-vacuity: a renamed component or a document that stopped publishing bounds would otherwise
    // leave every case below true of an empty list.
    assert.ok(capped.length >= 8, `expected at least 8 capped fields, found ${String(capped.length)}`);
  });

  for (const { component, field, over } of capped) {
    it(`${component}.${field} is refused one past its ceiling`, () => {
      // Parsed, never compared as a number: what matters is that the applicant is told at the keystroke,
      // and only the schema actually refusing does that.
      const result = MIRRORS[component]?.safeParse({ [field]: over });

      assert.ok(result !== undefined && !result.success, `${component}.${field} accepted a value past its ceiling`);
      assert.ok(
        result.error.issues.some((issue) => issue.path.join(".") === field),
        `${component}.${field} is over its ceiling and the refusal names another field`,
      );
    });
  }
});

const FORM_DIR = path.join(import.meta.dirname, "components", "forms", "BewerbungForm");
const readForm = (file: string) => readFileSync(path.join(FORM_DIR, file), "utf8");

/**
 * Each ceiling reaches the CONTROL as well as the schema, so a box stops accepting characters it would refuse.
 * `BEWERBUNG_WEBSITE_URL_MAX_LENGTH` is absent on purpose: its input is `WebsiteUrlField`, which belongs to
 * `features/teams` and takes no cap prop, so that one bound is enforced at the submit alone.
 */
const CAPPED_CONTROLS: Record<string, { file: string; boxes: number }> = {
  BEWERBUNG_TEAM_NAME_MAX_LENGTH: { file: "FormSchuleSection.tsx", boxes: 1 },
  BEWERBUNG_FULL_NAME_MAX_LENGTH: { file: "FormSchuleSection.tsx", boxes: 1 },
  // Two boxes each: both name fields, and both counts. A presence check is satisfied by either alone.
  BEWERBUNG_KONTAKT_NAME_MAX_LENGTH: { file: "FormKontaktpersonenSection.tsx", boxes: 2 },
  BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH: { file: "FormTeamSection.tsx", boxes: 1 },
  BEWERBUNG_KADER_GROESSE_MAX: { file: "FormTeamSection.tsx", boxes: 2 },
};

describe("where a ceiling reaches the box the applicant types in", () => {
  for (const [constant, { file, boxes }] of Object.entries(CAPPED_CONTROLS)) {
    it(`${file} caps every box that shares ${constant}`, () => {
      // COUNTED, and the constant rather than a retyped number: a literal on the input is a second ceiling
      // that drifts, and a presence check passes while the second box of a pair stays uncapped.
      // `[^}]*` so a cap COMPOSED with another bound still counts: `gute_spieler` is capped by the squad above
      // it and by the league ceiling at once, and only the composition is correct.
      const capped = readForm(file).match(new RegExp(`(maxLength|maxValue)=\{[^}]*${constant}`, "g")) ?? [];

      assert.equal(capped.length, boxes, `${file} caps ${String(capped.length)} of ${String(boxes)} boxes with ${constant}`);
    });
  }

  it("says the unchecked-Kürzel promise once, however the toast introduces it", () => {
    // Both render together on a rate-limited blur, so one promise in two wordings reads as two promises.
    assert.match(readForm("BewerbungForm.tsx"), /KUERZEL_RATE_LIMIT = `[^`]*\$\{KUERZEL_UNGEPRUEFT\}`/);
  });
});

describe("the rule a count is judged against as well as its ceiling", () => {
  /* The model validator's own: a subset cannot outnumber the whole. Refused HERE as well as there, because the
     submission's 422 banner names the contact details and nothing marks either count. */
  const kader = (voraussichtliche_groesse: number, gute_spieler: number) =>
    FLBewerbungKaderPayloadSchema.safeParse({ voraussichtliche_groesse, gute_spieler });

  it("refuses more strong players than squad, on the box the applicant lowers", () => {
    const result = kader(10, 20);

    assert.ok(!result.success);
    assert.deepEqual(
      result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
      [["gute_spieler", "Die Anzahl der guten Spieler darf die voraussichtliche Kadergröße nicht überschreiten."]],
    );
  });

  it("offers no count the subset rule would refuse", () => {
    // §7: never offer in the form what the write path refuses. The stepper's ceiling has to DEPEND on the
    // squad above it — capped at the league's 200 alone, it still offers 200 strong players in a squad of 10.
    assert.match(
      readForm("FormTeamSection.tsx"),
      /maxValue=\{[^}]*kader\.voraussichtliche_groesse[^}]*\}/,
      "the strong-player stepper offers counts the subset rule refuses",
    );
  });

  it("accepts a squad rated strong to the last player", () => {
    // Equal passes, as the model validator's own docstring says: a school may rate its whole squad.
    assert.ok(kader(10, 10).success);
  });
});
