import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { renderMarkup } from "@/shared/testing/renderTest";

import { strongPlayerCeiling } from "./components/forms/BewerbungForm/kaderBounds.ts";
import { BEWERBUNG_KADER_GROESSE_MAX, SCHULE_NICHT_IN_LISTE } from "./constants.ts";
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

/** `characters` is `null` where the field is bounded by a `maximum` instead, which caps a count and no box's width. */
type Capped = { component: string; field: string; characters: number | null; at: unknown; over: unknown };

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

        found.push({
          component,
          field,
          characters: maxLength,
          at: filler?.build(maxLength) ?? null,
          over: filler === undefined ? null : filler.build(maxLength + 1),
        });
      } else if (typeof maximum === "number") found.push({ component, field, characters: null, at: maximum, over: maximum + 1 });
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

/*
 Every module below is reached AFTER the harness above has evaluated, because that is when the JSX
 compile step is registered; a static import beside this one resolves first and dies on the extension.
*/
const { BewerbungForm } = await import("./components/forms/BewerbungForm/BewerbungForm.tsx");
const { FormSchuleSection } = await import("./components/forms/BewerbungForm/FormSchuleSection.tsx");
const { buildEmptyBewerbungSchule } = await import("./utils.ts");
const { WEBSITE_URL_SCHEME } = await import("@/features/teams/constants.ts");

const SCHULEN = [{ id: "68d0f2a4c1e2b3a4d5e6f708", name: "Lessing-Kolleg" }];

/**
 * Both arms, because neither reaches every box: the form opens with nothing picked, so the new-school
 * block only the picker's sentinel reaches is rendered beside it.
 */
const RENDERED = [
  renderMarkup(BewerbungForm, { saisonId: "2026", schulen: SCHULEN, isSchulenLesbar: true, vergebeneFarben: [] }),
  renderMarkup(FormSchuleSection, {
    schulen: SCHULEN,
    auswahl: SCHULE_NICHT_IN_LISTE,
    schule: buildEmptyBewerbungSchule(),
    stufengroesse: null,
    onAuswahlPicked: () => undefined,
    onSchuleChange: () => undefined,
    onStufengroesseChange: () => undefined,
    onFieldLeft: () => undefined,
    onSchulformPicked: () => undefined,
    onKuerzelLeft: () => undefined,
    kuerzelHinweis: null,
    isSchulenLesbar: true,
  }),
];

type Box = { path: string; cap: number | null; scheme: number };

/**
 * What the group prints in front of a box and the applicant never types. Read off the same render:
 * named here instead, a prefix that changed spelling would be measured against a number nobody re-read.
 */
function schemeBefore(html: string, at: number): number {
  const group = html.lastIndexOf('data-slot="input-group"', at);

  return group < 0 ? 0 : (/data-slot="input-group-prefix"[^>]*>([^<]*)</.exec(html.slice(group, at))?.[1] ?? "").length;
}

/**
 * Named inputs alone: a `NumberField`'s visible box carries no `name`, and the hidden input beside it
 * that does carries no cap either, so neither is a box a character ceiling could reach.
 */
function boxesIn(html: string): Box[] {
  const found: Box[] = [];

  for (const treffer of html.matchAll(/<input\b([^>]*)>/g)) {
    const attrs = treffer[1] ?? "";
    const feldpfad = /(?<![-\w])name="([^"]*)"/.exec(attrs)?.[1];

    if (feldpfad === undefined) continue;

    const gedeckelt = /(?<![-\w])maxlength="(\d+)"/i.exec(attrs)?.[1];

    found.push({
      path: feldpfad,
      cap: gedeckelt === undefined ? null : Number(gedeckelt),
      // A group's own input alone: a plain box further down the markup would otherwise be handed the
      // prefix of a group it does not sit in.
      scheme: /data-slot="input-group-input"/.test(attrs) ? schemeBefore(html, treffer.index) : 0,
    });
  }

  return found;
}

const BOXES = RENDERED.flatMap(boxesIn);

/** The last segment alone: no two published components cap a field of one name, which a case below holds. */
const feld = (pfad: string): string => pfad.split(".").at(-1) ?? pfad;

const boxesFor = (field: string): Box[] => BOXES.filter((box) => feld(box.path) === field);

/** A ceiling reaches the applicant only where EVERY box writing that field carries a cap of its own. */
function reachesABox(field: string): boolean {
  const own = boxesFor(field);

  return own.length > 0 && own.every((box) => box.cap !== null);
}

/*
 A ceiling reaching no box, declared: a box somebody uncapped and a box deliberately left uncapped
 render alike, so a sweep that merely found nothing would read a deleted cap as a decision.
*/
const OHNE_KASTEN = [
  // The season is the route's own segment, and no box on this form writes it.
  "FLPostBewerbungPayload.saison_id",
  // Capping the address here alone would split the public form from the editors, which cap none.
  "FLBewerbungKontaktpersonPayload.email",
];

describe("where a published ceiling reaches the box the applicant types in", () => {
  it("renders boxes to judge at all", () => {
    // Anti-vacuity: a section that stopped rendering leaves every case below true of an empty population.
    assert.ok(BOXES.length >= 20, `expected at least 20 named boxes, rendered ${String(BOXES.length)}`);
  });

  it("names each published ceiling by a field no other component publishes", () => {
    // A box is matched to its ceiling by the last segment of the path it writes, so two components
    // publishing one field name would each be judged against the other's boxes.
    const namen = capped.filter(({ characters }) => characters !== null).map(({ field }) => field);

    assert.equal(new Set(namen).size, namen.length, `two published components cap a field among ${namen.join(", ")}`);
  });

  it("declares exactly the published ceilings that reach no box", () => {
    // The half a hand-kept register cannot carry: a ceiling nobody ever wired to a control arrives
    // here on the day the backend publishes it, under no row anybody wrote.
    assert.deepEqual(
      capped
        .filter(({ characters, field }) => characters !== null && !reachesABox(field))
        .map(({ component, field }) => `${component}.${field}`)
        .sort(),
      [...OHNE_KASTEN].sort(),
    );
  });

  it("measures the furniture as the scheme the submitted value carries", () => {
    const box = BOXES.find((eintrag) => eintrag.path === "schule.website_url");

    assert.ok(box !== undefined, "no rendered box writes the school's website, so this case compares nothing");
    // Without it an emptied prefix beside a box raised to the whole ceiling passes the sweep, and the
    // applicant types the scheme's length in characters the submit then refuses.
    assert.equal(box.scheme, WEBSITE_URL_SCHEME.length, "the group prints something other than the scheme in front of the box");
  });

  for (const { component, field, characters } of capped) {
    if (characters === null || OHNE_KASTEN.includes(`${component}.${field}`)) continue;

    it(`${component}.${field} caps every box that writes it, at the ceiling minus the group's prefix`, () => {
      const own = boxesFor(field);

      assert.ok(own.length > 0, `no rendered box writes ${field}`);
      // Every box rather than one: three seats share `vorname` and `nachname`, and a pair whose second
      // box is uncapped satisfies a presence check.
      for (const box of own) {
        assert.ok(box.cap !== null, `${box.path} carries no cap, so the applicant types past a ceiling only the submit refuses`);
        assert.equal(
          box.cap + box.scheme,
          characters,
          `${box.path} caps at ${String(box.cap)} where the backend publishes ${String(characters)}`,
        );
      }
    });
  }
});

/*
 Read as source because a render carries none of it: a `NumberField` emits neither `max` nor
 `aria-valuemax`, and a toast is built at the press (`.claude/rules/frontend.md`).
*/
describe("the claims no rendered markup carries", () => {
  /* One box each: the Abi-Jahrgang is asked on the school's panel whichever arm of the picker the
     applicant is in, and the squad's own ceiling is asked on the team's. */
  for (const [file, constant] of [
    ["FormSchuleSection.tsx", "BEWERBUNG_STUFENGROESSE_MAX"],
    ["FormTeamSection.tsx", "BEWERBUNG_KADER_GROESSE_MAX"],
  ] as const) {
    it(`${file} caps its number box with ${constant}`, () => {
      const gedeckelt = readForm(file).match(new RegExp(`maxValue=\\{${constant}\\}`, "g")) ?? [];

      assert.equal(gedeckelt.length, 1, `${file} caps ${String(gedeckelt.length)} number boxes with ${constant}`);
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
