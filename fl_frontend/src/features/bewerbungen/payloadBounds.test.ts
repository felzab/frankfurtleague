import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { publishedCeilings, readPublishedDocument } from "@/core/publishedCeilings";
import { renderMarkup } from "@/shared/testing/renderTest";

import { kaderWithSquad, strongPlayerCeiling } from "./components/forms/BewerbungForm/kaderBounds.ts";
import { BEWERBUNG_KADER_GROESSE_MAX, SCHULE_NICHT_IN_LISTE } from "./constants.ts";
import { FLBewerbungKaderPayloadSchema } from "./schemas.ts";

/*
 The components whose fields this form's boxes write. Whether each mirror refuses their ceilings is
 `fl_frontend/src/core/payloadBounds.test.ts`'s, over every payload; this file asks whether a ceiling
 reaches the box the applicant types in, which only a render of this form answers.
*/
const FORM_COMPONENTS = [
  // The submission's own root, whose two capped fields sit on no nested block: an application's
  // season and the opponent it wishes for.
  "FLPostBewerbungPayload",
  "FLBewerbungSchulePayload",
  "FLBewerbungTrikotPayload",
  "FLBewerbungKaderPayload",
  "FLBewerbungKontaktpersonPayload",
];

const document = readPublishedDocument();
// A character ceiling alone reaches a box's width; a count's ceiling is its number box's, read below.
const widths = publishedCeilings(document, FORM_COMPONENTS).filter(({ keyword }) => keyword === "maxLength");

it("names only components the backend publishes", () => {
  // A renamed component would otherwise drop its ceilings out of every case below without failing one.
  assert.deepEqual(
    FORM_COMPONENTS.filter((component) => !(component in document.components.schemas)),
    [],
  );
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

const SCHOOLS = [{ id: "68d0f2a4c1e2b3a4d5e6f708", name: "Lessing-Kolleg" }];

/**
 * Both arms, because neither reaches every box: the form opens with nothing picked, so the new-school
 * block only the picker's sentinel reaches is rendered beside it.
 */
const RENDERED = [
  renderMarkup(BewerbungForm, { saisonId: "2026", schulen: SCHOOLS, isSchulenLesbar: true, vergebeneFarben: [] }),
  renderMarkup(FormSchuleSection, {
    schulen: SCHOOLS,
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

  for (const hit of html.matchAll(/<input\b([^>]*)>/g)) {
    const attrs = hit[1] ?? "";
    const fieldPath = /(?<![-\w])name="([^"]*)"/.exec(attrs)?.[1];

    if (fieldPath === undefined) continue;

    const capped2 = /(?<![-\w])maxlength="(\d+)"/i.exec(attrs)?.[1];

    found.push({
      path: fieldPath,
      cap: capped2 === undefined ? null : Number(capped2),
      // A group's own input alone: a plain box further down the markup would otherwise be handed the
      // prefix of a group it does not sit in.
      scheme: /data-slot="input-group-input"/.test(attrs) ? schemeBefore(html, hit.index) : 0,
    });
  }

  return found;
}

const BOXES = RENDERED.flatMap(boxesIn);

/** The last segment alone: no two published components cap a field of one name, which a case below holds. */
const field2 = (pfad: string): string => pfad.split(".").at(-1) ?? pfad;

const boxesFor = (field: string): Box[] => BOXES.filter((box) => field2(box.path) === field);

/** A ceiling reaches the applicant only where EVERY box writing that field carries a cap of its own. */
function reachesABox(field: string): boolean {
  const own = boxesFor(field);

  return own.length > 0 && own.every((box) => box.cap !== null);
}

/*
 A ceiling reaching no box, declared: a box somebody uncapped and a box deliberately left uncapped
 render alike, so a sweep that merely found nothing would read a deleted cap as a decision.
*/
const WITHOUT_BOX = [
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
    const names = widths.map(({ field }) => field);

    assert.equal(new Set(names).size, names.length, `two published components cap a field among ${names.join(", ")}`);
  });

  it("declares exactly the published ceilings that reach no box", () => {
    // The half a hand-kept register cannot carry: a ceiling nobody ever wired to a control arrives
    // here on the day the backend publishes it, under no row anybody wrote.
    assert.deepEqual(
      widths
        .filter(({ field }) => !reachesABox(field))
        .map(({ component, field }) => `${component}.${field}`)
        .sort(),
      [...WITHOUT_BOX].sort(),
    );
  });

  it("measures the furniture as the scheme the submitted value carries", () => {
    const box = BOXES.find((eintrag) => eintrag.path === "schule.website_url");

    assert.ok(box !== undefined, "no rendered box writes the school's website, so this case compares nothing");
    // Without it an emptied prefix beside a box raised to the whole ceiling passes the sweep, and the
    // applicant types the scheme's length in characters the submit then refuses.
    assert.equal(box.scheme, WEBSITE_URL_SCHEME.length, "the group prints something other than the scheme in front of the box");
  });

  for (const { component, field, bound } of widths) {
    if (WITHOUT_BOX.includes(`${component}.${field}`)) continue;

    it(`${component}.${field} caps every box that writes it, at the ceiling minus the group's prefix`, () => {
      const own = boxesFor(field);

      assert.ok(own.length > 0, `no rendered box writes ${field}`);
      // Every box rather than one: three seats share `vorname` and `nachname`, and a pair whose second
      // box is uncapped satisfies a presence check.
      for (const box of own) {
        assert.ok(box.cap !== null, `${box.path} carries no cap, so the applicant types past a ceiling only the submit refuses`);
        assert.equal(box.cap + box.scheme, bound, `${box.path} caps at ${String(box.cap)} where the backend publishes ${String(bound)}`);
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
      const capped2 = readForm(file).match(new RegExp(`maxValue=\\{${constant}\\}`, "g")) ?? [];

      assert.equal(capped2.length, 1, `${file} caps ${String(capped2.length)} number boxes with ${constant}`);
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

  it("brings the strong count down with a lowered squad, to a pair the write path takes", () => {
    // Squad 25 with 20 strong, lowered to 12: the strong box shows 12, and a draft left on 20 is refused under two 12s.
    const lowered = kaderWithSquad({ voraussichtliche_groesse: 25, gute_spieler: 20 }, 12);

    assert.deepEqual(lowered, { voraussichtliche_groesse: 12, gute_spieler: 12 });
    assert.equal(FLBewerbungKaderPayloadSchema.safeParse(lowered).success, true);
  });

  it("leaves a strong count the new ceiling still holds, and invents none", () => {
    assert.deepEqual(kaderWithSquad({ voraussichtliche_groesse: 25, gute_spieler: 3 }, 12), { voraussichtliche_groesse: 12, gute_spieler: 3 });
    assert.deepEqual(kaderWithSquad({ voraussichtliche_groesse: 12, gute_spieler: 12 }, 25), {
      voraussichtliche_groesse: 25,
      gute_spieler: 12,
    });
    assert.deepEqual(kaderWithSquad({ voraussichtliche_groesse: null, gute_spieler: null }, 5), {
      voraussichtliche_groesse: 5,
      gute_spieler: null,
    });
    // An emptied squad box lifts the ceiling to the league's own, which holds every count the box could show.
    assert.deepEqual(kaderWithSquad({ voraussichtliche_groesse: 12, gute_spieler: 7 }, null), {
      voraussichtliche_groesse: null,
      gute_spieler: 7,
    });
  });

  it("accepts a squad rated strong to the last player", () => {
    // Equal passes, as the model validator's own docstring says: a school may rate its whole squad.
    assert.ok(kader(10, 10).success);
  });
});
