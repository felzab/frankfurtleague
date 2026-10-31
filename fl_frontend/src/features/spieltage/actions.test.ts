import { createElement as h } from "react";

import { doubleActionRequest } from "@/test-support/actionDoubles.ts";
import { doubleApiAnswers, requestsOf } from "@/test-support/apiClientDouble.ts";
import { answerShown, assertEachAnswered, refusalCodes, refused } from "@/test-support/refusals.ts";
import { renderTree } from "@/test-support/renderMarkup.ts";
import { describe, expect, it } from "vitest";

import { buildSpieltagBanners } from "./components/forms/AdminSpieltagEditForm/banners.ts";
import { mapSpieltagRefusal } from "./refusals.ts";
import { deriveSpieltagDraftStatus } from "./spieltagDraftStatus.ts";

import type { Code } from "@/core/generated/client/types.ts";

/* The real action and its mutation, called: the request it runs in and the backend client are the doubles. */
doubleActionRequest();
const { answerWith, calls } = doubleApiAnswers();
const { patchSpieltagAction } = await import("./actions.ts");

const { FormZeitraumSection } = await import("./components/forms/AdminSpieltagEditForm/FormZeitraumSection.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

/**
 * The ordering rule, `fl_backend/app/api/spieltage/services.py :: find_spieltag_order_refusal`'s code.
 * Restated rather than looked up: the case below fails on a renumbering, and the loop over the
 * published codes then names the one the mapper leaves unanswered.
 */
const ORDERING_CODE = "spieltag_beginn_out_of_order";

/**
 * The German the mapper renders for one code, as a sentence. Thrown rather than answered as "": a
 * `doesNotMatch` below passes over an empty message while the German it is about is unwritten.
 */
function refusalMessage(code: Code): string {
  const message = mapSpieltagRefusal(refused(code))?.error ?? "";
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

describe("the matchday's write", () => {
  it("reaches its published path and method, the id in the path and the span alone in the body", async () => {
    const span = { beginn: "2026-03-12", ende: "2026-03-13" };
    const id = "6890a1b2c3d4e5f607182931";
    answerWith(() => Promise.resolve({ spieltag_id: id }));

    await patchSpieltagAction({ id, ...span });

    expect(requestsOf(calls)).toStrictEqual([{ endpoint: `/spieltage/${id}`, method: "PATCH", body: span }]);
  });
});

describe("the Spieltag refusals against the codes the matchday PATCH publishes", () => {
  for (const code of refusalCodes("spieltag_outside_saison", "spieltag_span_below_spiele", "spieltag_beginn_out_of_order")) {
    it(`${code} reaches the admin in German when the edit is saved`, () => {
      expect(answerShown(code, mapSpieltagRefusal), `${code} falls through to the generic conflict message when the edit is saved`).not.toBe(
        null,
      );
    });
  }

  it("answers every refusal the save publishes through the mapper", async () => {
    await assertEachAnswered({
      codes: refusalCodes("spieltag_outside_saison", "spieltag_span_below_spiele", "spieltag_beginn_out_of_order"),
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
    expect(refusalMessage(ORDERING_CODE)).toMatch(/in die Reihenfolge der Spieltage seiner Phase passen/);
    expect(spanWarningBody()).toMatch(/in die Reihenfolge der Spieltage seiner Phase passen/);
  });

  /* `dated_neighbour` answers `None` for an undated row, so the endpoint measures against the dated
     matchdays alone. A message naming the immediate neighbours sends the admin at a row reading
     "Noch kein Zeitraum", which states nothing they can act on. */
  it("keeps the admin off the undated matchdays the endpoint steps over", () => {
    expect(refusalMessage(ORDERING_CODE)).toMatch(/schon einen Zeitraum haben/);
    expect(spanWarningBody()).toMatch(/schon einen Zeitraum haben/);
  });

  /* `ende` is the one field the rule leaves free, and WHOSE flips with the arm: the predecessor's
     where this matchday is to be played first, this one's where it is to be postponed. Only the
     goal names the right row in both. */
  it("names the escape by the goal, which is the referent both arms share", () => {
    const message = refusalMessage(ORDERING_CODE);

    expect(message).toMatch(/Das Ende ist daran nicht gebunden und darf weiter reichen/);
    expect(message).toMatch(/die Spiele des Spieltags, der später gespielt werden soll/);
  });

  /* `FLPatchSpieltagPayloadSchema` refines `ende >= beginn` and the follower arm fires on
     `beginn > following.beginn`, so every refusal it can produce carries an `ende` past the
     neighbour. An imperative to widen it would name a step the admin has taken. */
  it("asks for no wider Ende, which the refused payload already carries", () => {
    expect(refusalMessage(ORDERING_CODE)).not.toMatch(/Erweitere/);
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
    expect(pickerCount(SINGLE_DAY)).toBe(1);
    expect(pickerCount(SPAN)).toBe(2);
    expect(fieldNames(SINGLE_DAY)).toStrictEqual(["beginn"]);
    expect(fieldNames(SPAN)).toStrictEqual(["beginn", "ende"]);
  });

  /* `mapSpieltagRefusal` puts the containment refusal on `beginn` and nothing else on a field, so
     a picker sitting elsewhere sends every one to
     `fl_frontend/src/shared/hooks/useServerFieldErrors.ts`'s unhandled-refusal toast. */
  it("keeps that picker on the one path a refusal can land on", () => {
    expect(fieldNames(SINGLE_DAY)).toStrictEqual(["beginn"]);
    const landed = refusalCodes("spieltag_outside_saison", "spieltag_span_below_spiele", "spieltag_beginn_out_of_order").flatMap((code) =>
      Object.keys(mapSpieltagRefusal(refused(code))?.fieldErrors ?? {}),
    );
    expect([...new Set(landed)]).toStrictEqual(["beginn"]);
  });

  /* A label is a promise about the value under it, and this day is the matchday's end as much as its
     beginning. */
  it("names the picker after neither end of a span", () => {
    expect(fieldLabels(SINGLE_DAY)).toStrictEqual(["Datum"]);
    expect(fieldLabels(SPAN)).toStrictEqual(["Beginn", "Ende"]);
  });

  /* Read off the derivation rather than off its source, so the rail's row and the control the reader
     is looking at are pinned to each other whichever of the two is renamed. */
  it("gives each panel's rows the labels that panel's pickers carry", () => {
    const railLabels = (isSingleDay: boolean): string[] =>
      deriveSpieltagDraftStatus({ stored: UNDATED, draft: UNDATED, fieldErrors: {}, isSingleDay }).fields.map((field) => field.label);

    expect(fieldLabels(SINGLE_DAY)).toStrictEqual(railLabels(true));
    expect(fieldLabels(SPAN)).toStrictEqual(railLabels(false));
  });
});
