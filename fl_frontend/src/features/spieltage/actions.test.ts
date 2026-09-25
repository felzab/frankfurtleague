import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleActionRequest, doubleActions } from "@/shared/testing/actionDoubles.ts";
import { answerShown, assertEachAnswered, publishedRefusals, refusedOn } from "@/shared/testing/publishedRefusals.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";
import { sliceBetween } from "@/shared/testing/sourceText.ts";

import { buildSpieltagBanners } from "./components/forms/AdminSpieltagEditForm/banners.ts";
import { mapSpieltagRefusal } from "./refusals.ts";
import { FLPatchSpieltagPayloadSchema } from "./schemas.ts";
import { deriveSpieltagDraftStatus } from "./spieltagDraftStatus.ts";

/* The real action, called: the request it runs in and the write it sends are the doubles. */
doubleActionRequest();
const { answerWith } = doubleActions({ modules: ["/src/features/spieltage/mutations.ts"] });
const { patchSpieltagAction } = await import("./actions.ts");

const { FormZeitraumSection } = await import("./components/forms/AdminSpieltagEditForm/FormZeitraumSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

/** The span validator the pickers feed, which is the backend's and not the Zod mirror's. */
const BACKEND_CUSTOM_SCHEMAS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "shared", "schemas", "custom.py"), "utf8");

const PATCH_OPERATION = "PATCH /spieltage/{spieltag_id}";

/**
 * The ordering rule, `fl_backend/app/api/spieltage/services.py :: find_spieltag_order_refusal`'s code.
 * Restated rather than looked up: the case below fails on a renumbering, and the loop over the
 * published codes then names the one the mapper leaves unanswered.
 */
const ORDERING_CODE = "REQ-DATE-008";

/**
 * The German the mapper renders for one code, as a sentence. Thrown rather than answered as "": a
 * `doesNotMatch` below passes over an empty message while the German it is about is unwritten.
 */
function refusalMessage(code: string): string {
  const message = mapSpieltagRefusal(refusedOn(PATCH_OPERATION, code))?.error ?? "";
  if (message === "") throw new Error(`the mapper words no message for ${code}`);

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

describe("the Spieltag refusals against the codes the matchday PATCH publishes", () => {
  it("publishes the ordering rule on the matchday PATCH", () => {
    assert.ok(publishedRefusals(PATCH_OPERATION).includes(ORDERING_CODE), `${ORDERING_CODE} is no longer the ordering rule's code`);
  });

  for (const code of publishedRefusals(PATCH_OPERATION)) {
    it(`${code} reaches the admin in German when the edit is saved`, () => {
      assert.notEqual(
        answerShown(PATCH_OPERATION, code, mapSpieltagRefusal),
        null,
        `${code} falls through to the generic conflict message when the edit is saved`,
      );
    });
  }

  it("answers every refusal the save publishes through the mapper", async () => {
    await assertEachAnswered({
      operation: PATCH_OPERATION,
      refuseWith: answerWith,
      act: () => patchSpieltagAction({ id: "6890a1b2c3d4e5f607182931", beginn: "2026-03-12", ende: "2026-03-12" }),
      mapped: mapSpieltagRefusal,
    });
  });
});

describe("the German the ordering refusal renders", () => {
  /* One code carries the refusal on EITHER side of this position, and the wire states neither, so a
     message naming one direction misdirects the admins who met the other. The ordering is the claim
     all three share, and one wording keeps it so. */
  it("claims the ordering itself rather than the direction one admin happened to meet", () => {
    assert.match(refusalMessage(ORDERING_CODE), /in die Reihenfolge der Spieltage seiner Phase passen/);
    assert.match(spanWarningBody(), /in die Reihenfolge der Spieltage seiner Phase passen/);
  });

  /* `dated_neighbour` answers `None` for an undated row, so the endpoint measures against the dated
     matchdays alone. A message naming the immediate neighbours sends the admin at a row reading
     "Noch kein Zeitraum", which states nothing they can act on. */
  it("keeps the admin off the undated matchdays the endpoint steps over", () => {
    assert.match(refusalMessage(ORDERING_CODE), /schon einen Zeitraum haben/);
    assert.match(spanWarningBody(), /schon einen Zeitraum haben/);
  });

  /* `ende` is the one field the rule leaves free, and WHOSE flips with the arm: the predecessor's
     where this matchday is to be played first, this one's where it is to be postponed. Only the
     goal names the right row in both. */
  it("names the escape by the goal, which is the referent both arms share", () => {
    const message = refusalMessage(ORDERING_CODE);

    assert.match(message, /Das Ende ist daran nicht gebunden und darf weiter reichen/);
    assert.match(message, /die Spiele des Spieltags, der später gespielt werden soll/);
  });

  /* `FLPatchSpieltagPayload` refines `ende >= beginn` and the follower arm fires on
     `beginn > following.beginn`, so every refusal it can produce carries an `ende` past the
     neighbour. An imperative to widen it would name a step the admin has taken. */
  it("asks for no wider Ende, which the refused payload already carries", () => {
    assert.doesNotMatch(refusalMessage(ORDERING_CODE), /Erweitere/);
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
    const landed = publishedRefusals(PATCH_OPERATION).flatMap((code) =>
      Object.keys(mapSpieltagRefusal(refusedOn(PATCH_OPERATION, code))?.fieldErrors ?? {}),
    );
    assert.deepEqual([...new Set(landed)], ["beginn"]);
  });

  /* A label is a promise about the value under it, and this day is the matchday's end as much as its
     beginning. */
  it("names the picker after neither end of a span", () => {
    assert.deepEqual(fieldLabels(SINGLE_DAY), ["Datum"]);
    assert.deepEqual(fieldLabels(SPAN), ["Beginn", "Ende"]);
  });

  /* A form may offer only what the write path takes. Both validators refuse a REVERSED span and
     neither refuses an equal one, which is what leaves the day picked once saveable. */
  it("offers a same-day span each validator standing behind it accepts", () => {
    // To the two blank lines the formatter closes a function with: cut at its first refusal, a second
    // refusal written below it would go unread.
    const guard = sliceBetween(BACKEND_CUSTOM_SCHEMAS, "def refuse_reversed_span", "\n\n\n");

    assert.ok(FLPatchSpieltagPayloadSchema.safeParse({ id: "0123456789abcdef01234567", beginn: "2026-09-04", ende: "2026-09-04" }).success);
    assert.equal(guard.match(/\braise\b/g)?.length, 1, "refuse_reversed_span refuses more than the reversed span");
    assert.match(guard, /if end < start:/);
    assert.doesNotMatch(guard, /<=/);
  });

  /* Read off the derivation rather than off its source, so the rail's row and the control the reader
     is looking at are pinned to each other whichever of the two is renamed. */
  it("gives each panel's rows the labels that panel's pickers carry", () => {
    const railLabels = (isSingleDay: boolean): string[] =>
      deriveSpieltagDraftStatus({ stored: UNDATED, draft: UNDATED, fieldErrors: {}, isSingleDay }).fields.map((field) => field.label);

    assert.deepEqual(fieldLabels(SINGLE_DAY), railLabels(true));
    assert.deepEqual(fieldLabels(SPAN), railLabels(false));
  });
});
