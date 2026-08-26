import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { DECLARED_RULES, declaredCodes } from "../../core/refusalRegister.ts";
import { buildSpieltagBanners } from "./components/forms/AdminSpieltagEditForm/banners.ts";

const ACTIONS = readFileSync(path.resolve(import.meta.dirname, "actions.ts"), "utf8");
const UNDO_ROUTE = readFileSync(path.resolve(import.meta.dirname, "..", "..", "app", "api", "admin", "spieltage", "undo", "route.ts"), "utf8");
/** Whitespace-collapsed: the hint is JSX text, so the formatter picks its line breaks, not the author. */
const HINT_SECTION = readFileSync(
  path.resolve(import.meta.dirname, "components", "forms", "AdminSpieltagEditForm", "FormZeitraumSection.tsx"),
  "utf8",
).replace(/\s+/g, " ");

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
    assert.match(HINT_SECTION, /schon einen Zeitraum haben/);
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

  /* The hint states the same rule beside the pickers, and drift is invisible: each reads correctly
     alone, and only the pair says whether both send the admin at the same rows. The hint can name
     both directions; the refusal, read after one, cannot. */
  it("states the same restriction in the hint the pickers carry", () => {
    assert.match(HINT_SECTION, /davor steht/);
    assert.match(HINT_SECTION, /danach steht/);
    // Around the `<strong>` the hint wraps `Ende` in, which the collapse leaves in place.
    assert.match(HINT_SECTION, /ist daran nicht gebunden und darf weiter reichen/);
    assert.match(HINT_SECTION, /später gespielt werden, verlege seine Spiele in die späteren Tage seines Zeitraums/);
  });
});

describe("the greying the Zeitraum hint promises", () => {
  /* The season is the only bound the pickers take, and that is a decision: `REQ-DATE-008` judges the
     STEP, so a static one would grey out a repair the endpoint allows. A promise wider than the
     bounds offers days the save then refuses. */
  it("promises greying no wider than the bounds the pickers carry", () => {
    const bounds = [...HINT_SECTION.matchAll(/(?:minValue|maxValue)=\{\w+\}/g)].map((match) => match[0]);
    const greying = HINT_SECTION.split("<li>").find((item) => item.includes("ausgegraut")) ?? "";

    assert.deepEqual([...new Set(bounds)].sort(), ["maxValue={spanEnd}", "minValue={spanStart}"]);
    assert.match(greying, /außerhalb der Saison/);
  });
});
