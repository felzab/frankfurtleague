import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { DECLARED_RULES, declaredCodes, sliceBetween } from "../../core/refusalRegister.ts";
import { FLSaisonPhaseSchema } from "../saisons/schemas.ts";
import { buildSpieltagBanners } from "./components/forms/AdminSpieltagEditForm/banners.ts";
import { FLPatchSpieltagPayloadSchema } from "./schemas.ts";
import { deriveSpieltagDraftStatus } from "./spieltagDraftStatus.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const EDITOR_DIR = path.resolve(import.meta.dirname, "components", "forms", "AdminSpieltagEditForm");

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const UNDO_ROUTE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin", "spieltage", "undo", "route.ts"), "utf8");
const ZEITRAUM_SECTION = readFileSync(path.resolve(EDITOR_DIR, "FormZeitraumSection.tsx"), "utf8");
const EDIT_FORM = readFileSync(path.resolve(EDITOR_DIR, "AdminSpieltagEditForm.tsx"), "utf8");
/** The span validator the pickers feed, which is the backend's and not the Zod mirror's. */
const BACKEND_CUSTOM_SCHEMAS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "shared", "schemas", "custom.py"), "utf8");
/** Whitespace-collapsed: the formatter picks the hint body's line breaks, not the author. */
const HINT_SECTION = ZEITRAUM_SECTION.replace(/\s+/g, " ");

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
  return [...refusalArm(code).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) => match[1]).join("");
}

/** The moved-span warning's body, which states the rule BEFORE a save rather than after one. */
function spanWarningBody(): string {
  const banners = buildSpieltagBanners({
    label: "2. Spieltag",
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

  for (const code of PATCH_CODES) {
    it(`${code} reaches the admin in German on both write paths`, () => {
      assert.notEqual(refusalArm(code), "", `${code} falls through to the generic conflict message when the edit is saved`);
      assert.notEqual(replayRow(code), "", `${code} falls through to the generic conflict message when the edit is undone`);

      // A replay that fails restores nothing, so a message stopping short of this reads as though
      // the matchday were now in neither state.
      assert.ok(replayRow(code).endsWith("Die Änderung steht weiterhin."), `${code}'s undo message leaves the outcome unstated`);
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

describe("the greying the Zeitraum hint promises", () => {
  /* The season is the only bound the pickers take, and that is a decision: `REQ-DATE-008` judges the
     STEP, so a static one would grey out a repair the endpoint allows. A promise wider than the
     bounds offers days the save then refuses. */
  it("promises greying no wider than the bounds the pickers carry", () => {
    const bounds = [...HINT_SECTION.matchAll(/(?:minValue|maxValue)=\{\w+\}/g)].map((match) => match[0]);
    const greying = HINT_SECTION.split("{ term:").find((item) => item.includes("ausgegraut")) ?? "";

    assert.deepEqual([...new Set(bounds)].sort(), ["maxValue={spanEnd}", "minValue={spanStart}"]);
    assert.match(greying, /außerhalb der Saison/);
  });
});

/**
 * One of the panel's two field arrangements, cut at the markers that open and close its branch. The
 * comment lines go first: one quoting an attribute it explains would otherwise count as a field.
 */
const zeitraumBranch = (from: string, to: string): string => sliceBetween(ZEITRAUM_SECTION, from, to).replace(/^\s*\/\/.*$/gm, "");

const SINGLE_DAY_FIELDS = zeitraumBranch("{isSingleDay ? (", ") : (");
const SPAN_FIELDS = zeitraumBranch("<>", "</>");

const fieldNames = (branch: string): string[] => [...branch.matchAll(/name="(\w+)"/g)].map((match) => match[1] ?? "");
const fieldLabels = (branch: string): string[] => [...branch.matchAll(/<FieldLabel path="\w+">([^<]+)</g)].map((match) => match[1] ?? "");

describe("the one date a final's Spieltag is given", () => {
  /* The final is a single match played inside one day, so a second picker asks for a date whose only
     legal value is the one already entered. */
  it("puts one picker where a span puts two", () => {
    assert.deepEqual(fieldNames(SINGLE_DAY_FIELDS), ["beginn"]);
    assert.deepEqual(fieldNames(SPAN_FIELDS), ["beginn", "ende"]);
  });

  /* `mapSpieltagRefusal` puts the containment refusal on `beginn` and nothing else on a field, so
     a picker sitting elsewhere sends every one to
     `fl_frontend/src/shared/hooks/useServerFieldErrors.ts`'s unhandled-refusal toast. */
  it("keeps that picker on the one path a refusal can land on", () => {
    assert.deepEqual(fieldNames(SINGLE_DAY_FIELDS), ["beginn"]);
    assert.match(ACTIONS, /fieldErrors: \{ beginn:/);
  });

  /* A label is a promise about the value under it, and this day is the matchday's end as much as its
     beginning. */
  it("names the picker after neither end of a span", () => {
    assert.deepEqual(fieldLabels(SINGLE_DAY_FIELDS), ["Datum"]);
    assert.deepEqual(fieldLabels(SPAN_FIELDS), ["Beginn", "Ende"]);
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
    const undated = { beginn: "", ende: "" };
    const railLabels = (isSingleDay: boolean): string[] =>
      deriveSpieltagDraftStatus({ stored: undated, draft: undated, fieldErrors: {}, isSingleDay }).fields.map((field) => field.label);

    assert.deepEqual(fieldLabels(SINGLE_DAY_FIELDS), railLabels(true));
    assert.deepEqual(fieldLabels(SPAN_FIELDS), railLabels(false));
  });

  /* `fl_backend/app/core/domain.py :: UNENFORCED` names this file as where a matchday off its implied
     count is seen at all, and only the editor page's own fixture read fills the number it is seen by. */
  it("reports the count gap from the row the editor's fixture read filled", () => {
    assert.match(sliceBetween(EDIT_FORM, "buildSpieltagBanners({", "})"), /spieleAngelegt: spieltag\.spieleAngelegt/);
  });
});
