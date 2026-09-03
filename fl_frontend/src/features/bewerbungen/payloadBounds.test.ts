import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { strongPlayerCeiling } from "./components/forms/BewerbungForm/kaderBounds.ts";
import { BEWERBUNG_KADER_GROESSE_MAX } from "./constants.ts";
import {
  FLBewerbungKaderPayloadSchema,
  FLBewerbungKontaktpersonPayloadSchema,
  FLBewerbungSchulePayloadSchema,
  FLBewerbungTrikotPayloadSchema,
  FLPostBewerbungPayloadSchema,
} from "./schemas.ts";

import type { ZodType } from "zod";

const DOCUMENT = path.resolve(import.meta.dirname, "..", "..", "..", "..", "fl_backend", "openapi.json");

/**
 * Discovered from the backend's own document rather than listed here: a ceiling this file names is one somebody
 * remembered, and the ceiling added next is the one nobody adds.
 */
const MIRRORS: Record<string, ZodType> = {
  // The submission's own root, whose two capped fields sit on no nested block: an application's
  // season and the opponent it wishes for.
  FLPostBewerbungPayload: FLPostBewerbungPayloadSchema,
  FLBewerbungSchulePayload: FLBewerbungSchulePayloadSchema,
  FLBewerbungTrikotPayload: FLBewerbungTrikotPayloadSchema,
  FLBewerbungKaderPayload: FLBewerbungKaderPayloadSchema,
  FLBewerbungKontaktpersonPayload: FLBewerbungKontaktpersonPayloadSchema,
};

type Capped = { component: string; field: string; at: unknown; over: unknown };

/** A host of exactly this many characters: `z.regexes.domain` caps ONE label at 63, so past that it dots. */
function dottedHost(length: number): string {
  const labels: string[] = [];
  let left = length;

  // 61, not 60: leaving exactly zero would append an empty final label and trail the host with a dot.
  while (left > 61) {
    labels.push("a".repeat(60));
    left -= 61;
  }
  labels.push("a".repeat(left));

  return labels.join(".");
}

/**
 * Values of an exact length in the shapes these payloads take: `"a".repeat(301)` is refused by a URL
 * field whatever its ceiling, so it would pass this file with `.max()` deleted. Only a value the
 * mirror otherwise accepts shows the ceiling.
 */
const FILLERS: { min: number; build: (length: number) => string }[] = [
  { min: 1, build: (length) => "a".repeat(length) },
  { min: 12, build: (length) => `https://${dottedHost(length - 11)}.de` },
  { min: 13, build: (length) => `${"a".repeat(length - 12)}@beispiel.de` },
];

/** Whether the mirror leaves this field unfaulted — the object around it is partial, so only its own path counts. */
function fieldAccepts(component: string, field: string, value: unknown): boolean {
  const result = MIRRORS[component]?.safeParse({ [field]: value });

  return result !== undefined && (result.success || result.error.issues.every((issue) => issue.path.join(".") !== field));
}

function cappedFields(): Capped[] {
  const document = JSON.parse(readFileSync(DOCUMENT, "utf8")) as {
    components: { schemas: Record<string, { properties?: Record<string, Record<string, unknown>> }> };
  };
  const found: Capped[] = [];

  for (const component of Object.keys(MIRRORS)) {
    const properties = document.components.schemas[component]?.properties ?? {};
    for (const [field, spec] of Object.entries(properties)) {
      // A nullable field publishes its bound inside `anyOf`, never beside the type: read only the outer
      // level and `website_url`'s own ceiling is silently unswept.
      const branches = [spec, ...((spec.anyOf as Record<string, unknown>[] | undefined) ?? [])];
      const maxLength = branches.map((branch) => branch.maxLength).find((value) => typeof value === "number");
      const maximum = branches.map((branch) => branch.maximum).find((value) => typeof value === "number");

      // One past the ceiling and one at it, in the shape the field takes.
      if (typeof maxLength === "number") {
        const filler = FILLERS.find((candidate) => candidate.min <= maxLength && fieldAccepts(component, field, candidate.build(maxLength)));

        found.push({ component, field, at: filler?.build(maxLength) ?? null, over: filler === undefined ? null : filler.build(maxLength + 1) });
      } else if (typeof maximum === "number") found.push({ component, field, at: maximum, over: maximum + 1 });
    }
  }

  return found;
}

const capped = cappedFields();

describe("every ceiling the backend publishes is one the mirror refuses", () => {
  it("finds the capped fields to judge", () => {
    // Anti-vacuity: a renamed component or a document that stopped publishing bounds would otherwise
    // leave every case below true of an empty list.
    assert.ok(capped.length >= 10, `expected at least 10 capped fields, found ${String(capped.length)}`);
  });

  it("judges each of them with a value its own shape accepts", () => {
    // Without this, a field whose shape no filler fits is still swept and still passes — refused at the
    // ceiling and past it alike, for a reason that is not the ceiling.
    assert.deepEqual(
      capped.filter(({ at }) => at === null).map(({ component, field }) => `${component}.${field}`),
      [],
    );
  });

  for (const { component, field, at, over } of capped) {
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

    it(`${component}.${field} is accepted at its ceiling`, () => {
      // The half that makes the case above about the CEILING: a field refused at its own limit is one
      // the mirror bounds tighter than the backend publishes, and the applicant is stopped early.
      assert.ok(fieldAccepts(component, field, at), `${component}.${field} is refused at the ceiling the backend publishes`);
    });
  }
});

const FORM_DIR = path.join(import.meta.dirname, "components", "forms", "BewerbungForm");
const readForm = (file: string) => readFileSync(path.join(FORM_DIR, file), "utf8");

/**
 * Each ceiling reaches the CONTROL as well as the schema. `KONTAKT_EMAIL_MAX_LENGTH` is the one that does not:
 * it binds no input anywhere, and binding it here alone would split the public form from the editors.
 */
const CAPPED_CONTROLS: Record<string, { file: string; boxes: number }> = {
  TEAM_NAME_MAX_LENGTH: { file: "FormSchuleSection.tsx", boxes: 1 },
  TEAM_FULL_NAME_MAX_LENGTH: { file: "FormSchuleSection.tsx", boxes: 1 },
  // Two boxes each: both name fields, and both counts. A presence check is satisfied by either alone.
  KONTAKT_NAME_MAX_LENGTH: { file: "FormKontaktpersonenSection.tsx", boxes: 2 },
  // Its box holds the URL WITHOUT the scheme, so the cap is composed rather than the constant alone.
  TEAM_WEBSITE_URL_MAX_LENGTH: { file: "FormSchuleSection.tsx", boxes: 1 },
  BEWERBUNG_TRIKOT_SATZ_MAX_LENGTH: { file: "FormTeamSection.tsx", boxes: 1 },
  BEWERBUNG_WUNSCHGEGNER_MAX_LENGTH: { file: "FormTeamSection.tsx", boxes: 1 },
  // One box: the strong-player box takes its ceiling from `strongPlayerCeiling`, which the cases
  // below compare against the schema by parsing rather than by counting a constant in the JSX.
  BEWERBUNG_KADER_GROESSE_MAX: { file: "FormTeamSection.tsx", boxes: 1 },
};

describe("where a ceiling reaches the box the applicant types in", () => {
  for (const [constant, { file, boxes }] of Object.entries(CAPPED_CONTROLS)) {
    it(`${file} caps every box that shares ${constant}`, () => {
      // The constant, never a retyped number: a literal on the input is a second ceiling that drifts. `[^}]*`
      // admits a cap COMPOSED with another bound, as `gute_spieler`'s is. The brace's backslash is doubled
      // past the template literal's own escaping.
      const capped = readForm(file).match(new RegExp(`(maxLength|maxValue)=\\{[^}]*${constant}`, "g")) ?? [];

      // COUNTED, never merely present: a pair whose second box is uncapped satisfies a presence check.
      assert.equal(capped.length, boxes, `${file} caps ${String(capped.length)} of ${String(boxes)} boxes with ${constant}`);
    });
  }

  /* The presence check above is satisfied by the constant alone. */
  it("subtracts the scheme from the one cap whose box does not hold it", () => {
    // The website box holds the URL WITHOUT the scheme, which the group renders as furniture.
    // Capped at the payload's own ceiling it would accept the scheme's length in characters the
    // submit then refuses.
    assert.match(
      readForm("FormSchuleSection.tsx"),
      /maxLength=\{TEAM_WEBSITE_URL_MAX_LENGTH - WEBSITE_URL_SCHEME\.length\}/,
      "the website box is capped at the whole payload's ceiling, scheme included",
    );
  });

  /* A cap the field accepts and never applies is a prop that reads as enforcement. */
  it("applies the cap it is given to the box the applicant types in", () => {
    const feld = readFileSync(path.resolve(import.meta.dirname, "..", "teams", "components", "forms", "WebsiteUrlField.tsx"), "utf8");

    assert.match(feld, /maxLength\?: number;/, "the field takes no cap");
    assert.match(feld, /<InputGroup\.Input\s+maxLength=\{maxLength\}/, "the field takes a cap it never puts on the input");
  });

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
    // `.claude/rules/cross-surface.md`: never offer in the form what the write path refuses. Parsed rather than read back as text —
    // an assertion that greps the JSX for the squad passes `Math.max` exactly as it passes `Math.min`.
    for (const squad of [1, 2, 10, BEWERBUNG_KADER_GROESSE_MAX]) {
      const ceiling = strongPlayerCeiling(squad);

      assert.equal(
        kader(squad, ceiling).success,
        true,
        `a squad of ${String(squad)} is offered ${String(ceiling)}, which the write path refuses`,
      );
      assert.equal(
        kader(squad, ceiling + 1).success,
        false,
        `a squad of ${String(squad)} stops at ${String(ceiling)} where the write path takes more`,
      );
    }
  });

  it("offers no count the schema refuses outright, whatever squad was typed", () => {
    // A squad above the league's ceiling is already refused on its own box, so no pair of counts can
    // reach this. The strong box may still not OFFER a number `gute_spieler` can never take.
    for (const squad of [BEWERBUNG_KADER_GROESSE_MAX + 1, 500]) {
      assert.equal(
        strongPlayerCeiling(squad),
        BEWERBUNG_KADER_GROESSE_MAX,
        `a squad of ${String(squad)} raises the strong box past the league's ceiling`,
      );
    }
  });
  it("caps an unanswered squad at the league's own ceiling", () => {
    // The other half of the composition: with no squad to bound it, the box may still not offer more
    // than the schema takes at all.
    assert.equal(strongPlayerCeiling(null), BEWERBUNG_KADER_GROESSE_MAX);
    assert.equal(kader(BEWERBUNG_KADER_GROESSE_MAX, strongPlayerCeiling(null)).success, true);
    assert.equal(kader(BEWERBUNG_KADER_GROESSE_MAX, strongPlayerCeiling(null) + 1).success, false);
  });

  it("binds that ceiling to the box the applicant types in", () => {
    // The function is only the form's ceiling while the form calls it.
    assert.match(readForm("FormTeamSection.tsx"), /maxValue=\{strongPlayerCeiling\(kader\.voraussichtliche_groesse\)\}/);
  });

  it("accepts a squad rated strong to the last player", () => {
    // Equal passes, as the model validator's own docstring says: a school may rate its whole squad.
    assert.ok(kader(10, 10).success);
  });
});
