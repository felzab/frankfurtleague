import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { renderTree } from "@/shared/testing/renderTest.ts";

import { DECLARED_RULES, declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";
import { FLSaisonPhaseSchema } from "../saisons/schemas.ts";
import { buildSpieltagBanners } from "./components/forms/AdminSpieltagEditForm/banners.ts";
import { FLPatchSpieltagPayloadSchema } from "./schemas.ts";
import { deriveSpieltagDraftStatus } from "./spieltagDraftStatus.ts";

const { FormZeitraumSection } = await import("./components/forms/AdminSpieltagEditForm/FormZeitraumSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const EDITOR_DIR = path.resolve(import.meta.dirname, "components", "forms", "AdminSpieltagEditForm");

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const UNDO_ROUTE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin", "spieltage", "undo", "route.ts"), "utf8");
const EDIT_FORM = readFileSync(path.resolve(EDITOR_DIR, "AdminSpieltagEditForm.tsx"), "utf8");
/** The span validator the pickers feed, which is the backend's and not the Zod mirror's. */
const BACKEND_CUSTOM_SCHEMAS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "shared", "schemas", "custom.py"), "utf8");
/** Whitespace-collapsed: the formatter picks the hint body's line breaks, not the author. */
const HINT_SECTION = readFileSync(path.resolve(EDITOR_DIR, "FormZeitraumSection.tsx"), "utf8").replace(/\s+/g, " ");

const PATCH_OPERATION = "PATCH /spieltage/{spieltag_id}";

/** Every refusal the matchday PATCH declares, read off the register rather than restated here. */
const PATCH_CODES = declaredCodes(PATCH_OPERATION);

/**
 * The ordering rule, found by the symbol implementing it: its code is renumbered whenever the
 * programme reserves that number, and a restated one would then prove a rule nobody wrote.
 */
function orderingCode(): string {
  return DECLARED_RULES.find((rule) => rule.source.includes("find_spieltag_order_refusal"))?.code ?? "";
}

/** The body of one `serverErrorCode === "<code>"` branch, cut at the brace that closes it. */
function refusalArm(code: string): string {
  const rest = ACTIONS.split(`error.serverErrorCode === "${code}"`)[1] ?? "";
  // The closing brace and not the next branch: the LAST arm has none after it, and everything the
  // module holds below would then answer an assertion meant for one message.
  return rest.split("\n  }")[0] ?? "";
}

/**
 * The German one arm renders, its literals joined back into one string. A long message is written as
 * a concatenation, so the seam falls wherever the line ran out and lands mid-phrase often enough.
 */
function refusalMessage(code: string): string {
  const message = [...refusalArm(code).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]).join("");

  // Thrown rather than answered as "": a `doesNotMatch` below passes over an empty message while the
  // German it is about is unwritten.
  if (message === "") throw new Error(`the mapper spells no message for ${code}`);

  return message;
}

/** The moved-span warning's body, which states the rule BEFORE a save rather than after one. */
function spanWarningBody(): string {
  const banners = buildSpieltagBanners({
    isZeitraumChanged: true,
    isEndeVorBeginn: false,
    spieleAngelegt: 4,
    anzahlSpiele: 4,
  });

  return banners.find((banner) => banner.id === "spieltag.zeitraum-changed")?.body ?? "";
}

/** One row of the undo route's replay table, which is a literal keyed by code. */
function replayRow(code: string): string {
  return new RegExp(`"${code}":\\s*"([^"]*)"`).exec(UNDO_ROUTE)?.[1] ?? "";
}

describe("the Spieltag refusals against the backend's register", () => {
  it("finds the matchday PATCH's rules at all", () => {
    // A floor rather than the list: a restated list fails on a renumbering, which is the one thing
    // here that changes without a German message going missing.
    assert.ok(PATCH_CODES.length >= 3, `expected at least 3 declared refusals, found ${String(PATCH_CODES.length)}`);
    assert.match(orderingCode(), /^REQ-DATE-\d{3}$/);
  });

  /* Hoisted rather than spelled per row: a row keeping its own copy would reach the admin twice in
     the toast the route joins the two into. */
  it("adds the outcome sentence once, outside the rows", () => {
    assert.ok(
      UNDO_ROUTE.includes('const CHANGE_STANDS = "Die Änderung steht weiterhin.";'),
      "the replay no longer tells the admin what became of the change",
    );
    assert.ok(UNDO_ROUTE.includes("`${refusal} ${CHANGE_STANDS}`"), "a refused replay answers the cause with no outcome beside it");
  });

  for (const code of PATCH_CODES) {
    it(`${code} reaches the admin in German on both write paths`, () => {
      const row = replayRow(code);

      assert.notEqual(refusalArm(code), "", `${code} falls through to the generic conflict message when the edit is saved`);
      assert.notEqual(row, "", `${code} falls through to the generic conflict message when the edit is undone`);
      // The route joins the row to the outcome with a space, so a row without its own stop runs the two sentences together.
      assert.ok(row.endsWith("."), `${code}'s replay row does not close its sentence`);
      assert.ok(!row.includes("Die Änderung steht weiterhin"), `${code}'s row states the outcome the route already adds`);
    });
  }
});

describe("the German the ordering refusal renders", () => {
  /* One code carries the refusal on EITHER side of this position, and the wire states neither, so a
     message naming one direction misdirects the admins who met the other. The ordering is the claim
     all three share, and one wording keeps it so. */
  it("claims the ordering itself rather than the direction one admin happened to meet", () => {
    assert.match(refusalMessage(orderingCode()), /in die Reihenfolge der Spieltage seiner Phase passen/);
    assert.match(replayRow(orderingCode()), /in die Reihenfolge der Spieltage seiner Phase/);
    assert.match(spanWarningBody(), /in die Reihenfolge der Spieltage seiner Phase passen/);
  });

  /* `dated_neighbour` answers `None` for an undated row, so the endpoint measures against the dated
     matchdays alone. A message naming the immediate neighbours sends the admin at a row reading
     "Noch kein Zeitraum", which states nothing they can act on. */
  it("keeps the admin off the undated matchdays the endpoint steps over", () => {
    assert.match(refusalMessage(orderingCode()), /schon einen Zeitraum haben/);
    assert.match(replayRow(orderingCode()), /schon einen Zeitraum haben/);
    assert.match(spanWarningBody(), /schon einen Zeitraum haben/);
  });

  /* `ende` is the one field the rule leaves free, and WHOSE flips with the arm: the predecessor's
     where this matchday is to be played first, this one's where it is to be postponed. Only the
     goal names the right row in both. */
  it("names the escape by the goal, which is the referent both arms share", () => {
    const message = refusalMessage(orderingCode());

    assert.match(message, /Das Ende ist daran nicht gebunden und darf weiter reichen/);
    assert.match(message, /die Spiele des Spieltags, der später gespielt werden soll/);
  });

  /* `FLPatchSpieltagPayload` refines `ende >= beginn` and the follower arm fires on
     `beginn > following.beginn`, so every refusal it can produce carries an `ende` past the
     neighbour. An imperative to widen it would name a step the admin has taken. */
  it("asks for no wider Ende, which the refused payload already carries", () => {
    assert.doesNotMatch(refusalMessage(orderingCode()), /Erweitere/);
  });
});

describe("what bounds the Zeitraum pickers", () => {
  /* The season is the only bound the pickers take, and that is a decision: `REQ-DATE-008` judges the
     STEP, so a static one would grey out a repair the endpoint allows. The greying is the calendar's
     own answer and carries no sentence beside it (`docs/frontend/spec.md` §1.12, diagnostic 4), so a
     bound reaching wider than the span would be the only thing left saying which days are offered. */
  it("bounds both pickers by the season's span, and promises the greying in no sentence", () => {
    // Both claims are read off the panel's text: react-aria keeps a calendar's bounds in the popover
    // it opens, and the hint body sits in a second one, so a rendering of the closed panel has neither.
    const bounds = [...HINT_SECTION.matchAll(/(?:minValue|maxValue)=\{\w+\}/g)].map((match) => match[0]);

    assert.deepEqual([...new Set(bounds)].sort(), ["maxValue={spanEnd}", "minValue={spanStart}"]);
    assert.doesNotMatch(HINT_SECTION, /ausgegraut/);
  });
});

/** The matchday nothing has been entered for, which both the rail and the pickers are read against. */
const UNDATED = { beginn: "", ende: "" };

const zeitraumMarkup = (isSingleDay: boolean): string =>
  renderTree(
    h(DraftStatusProvider, {
      status: deriveSpieltagDraftStatus({ stored: UNDATED, draft: UNDATED, fieldErrors: {}, isSingleDay }),
      children: h(FormZeitraumSection, {
        beginn: "2026-09-04",
        ende: "2026-09-06",
        isSingleDay,
        onBeginnChange: () => undefined,
        onEndeChange: () => undefined,
        saisonSpan: { start: "2026-08-01", end: "2027-05-31" },
        banners: [],
      }),
    }),
  );

const SINGLE_DAY = zeitraumMarkup(true);
const SPAN = zeitraumMarkup(false);

/** The paths the panel submits under. Deduplicated: react-aria mirrors each picker into two inputs. */
const fieldNames = (html: string): string[] => [...new Set([...html.matchAll(/\sname="(\w+)"/g)].map((match) => match[1] ?? ""))];

const fieldLabels = (html: string): string[] => [...html.matchAll(/data-slot="label">([^<]*)</g)].map((match) => match[1] ?? "");

const pickerCount = (html: string): number => (html.match(/data-slot="date-picker"/g) ?? []).length;

describe("the one date a final's Spieltag is given", () => {
  /* The final is a single match played inside one day, so a second picker asks for a date whose only
     legal value is the one already entered. */
  it("puts one picker where a span puts two", () => {
    assert.equal(pickerCount(SINGLE_DAY), 1);
    assert.equal(pickerCount(SPAN), 2);
    assert.deepEqual(fieldNames(SINGLE_DAY), ["beginn"]);
    assert.deepEqual(fieldNames(SPAN), ["beginn", "ende"]);
  });

  /* `mapSpieltagRefusal` puts the containment refusal on `beginn` and nothing else on a field, so
     a picker sitting elsewhere sends every one to
     `fl_frontend/src/shared/hooks/useServerFieldErrors.ts`'s unhandled-refusal toast. */
  it("keeps that picker on the one path a refusal can land on", () => {
    assert.deepEqual(fieldNames(SINGLE_DAY), ["beginn"]);
    assert.match(ACTIONS, /fieldErrors: \{ beginn:/);
  });

  /* A label is a promise about the value under it, and this day is the matchday's end as much as its
     beginning. */
  it("names the picker after neither end of a span", () => {
    assert.deepEqual(fieldLabels(SINGLE_DAY), ["Datum"]);
    assert.deepEqual(fieldLabels(SPAN), ["Beginn", "Ende"]);
  });

  /* `spieltagLabels` composes the rendered name from the phase and `position`, so a form choosing on
     it would follow a string the page makes rather than the row's own state. */
  it("chooses on the stored phase rather than on the rendered name", () => {
    const decision = sliceBetween(EDIT_FORM, "const isSingleDay", ";");
    const phase = /saison_phase === "(\w+)"/.exec(decision)?.[1] ?? "";

    assert.ok(FLSaisonPhaseSchema.safeParse(phase).success, `${phase} is no phase the season schema declares`);
    assert.doesNotMatch(decision, /label/);
  });

  /* A form may offer only what the write path takes. Both validators refuse a REVERSED span and
     neither refuses an equal one, which is what leaves the day picked once saveable. */
  it("offers a same-day span each validator standing behind it accepts", () => {
    const guard = sliceBetween(BACKEND_CUSTOM_SCHEMAS, "def refuse_reversed_span", "raise ValueError");

    assert.ok(FLPatchSpieltagPayloadSchema.safeParse({ id: "0123456789abcdef01234567", beginn: "2026-09-04", ende: "2026-09-04" }).success);
    assert.match(guard, /if end < start:/);
    assert.doesNotMatch(guard, /<=/);
  });

  /* The picked day reaches `ende` in the draft rather than at the save, so the endpoint is sent the
     pair it declares from either panel and no later step learns which one built it. */
  it("builds the same payload from either panel", () => {
    assert.match(
      sliceBetween(EDIT_FORM, "const buildPayload", ";"),
      /\(\): FLPatchSpieltagPayload => \(\{ id: spieltag\.id, beginn, ende \}\)/,
    );
    assert.doesNotMatch(sliceBetween(EDIT_FORM, "const buildPayload", ";"), /isSingleDay/);
    assert.match(EDIT_FORM, /if \(isSingleDay\) setEnde\(next\);/);
  });

  /* A change list still describing two fields would name a picker that is not on screen and count one
     picked day as two changes, which is also what `ConfirmDiscardModal` offers to throw away. */
  it("tells the change list which panel it is describing", () => {
    assert.match(sliceBetween(EDIT_FORM, "deriveSpieltagDraftStatus({", "})"), /isSingleDay/);
  });

  /* Read off the derivation rather than off its source, so the rail's row and the control the reader
     is looking at are pinned to each other whichever of the two is renamed. */
  it("gives each panel's rows the labels that panel's pickers carry", () => {
    const railLabels = (isSingleDay: boolean): string[] =>
      deriveSpieltagDraftStatus({ stored: UNDATED, draft: UNDATED, fieldErrors: {}, isSingleDay }).fields.map((field) => field.label);

    assert.deepEqual(fieldLabels(SINGLE_DAY), railLabels(true));
    assert.deepEqual(fieldLabels(SPAN), railLabels(false));
  });

  /* `fl_backend/app/core/domain.py :: UNENFORCED` names this file as where a matchday off its implied
     count is seen at all, and only the editor page's own fixture read fills the number it is seen by. */
  it("reports the count gap from the row the editor's fixture read filled", () => {
    assert.match(sliceBetween(EDIT_FORM, "buildSpieltagBanners({", "})"), /spieleAngelegt: spieltag\.spieleAngelegt/);
  });
});
