import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

import { assertLeer } from "@/shared/testing/leerGrade.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import { SPIELER_ANONYM_LABEL } from "../../constants.ts";

import type { FLSpielerPublic } from "../../schemas.ts";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { TeamSpielerView } = await import("./TeamSpielerView.tsx");

const VEROEFFENTLICHT: FLSpielerPublic = {
  id: "6890a1b2c3d4e5f607390031",
  vorname: "Alina",
  nachname: "F.",
  nummer: "7",
  position: "Angriff",
};

/** What `READ-PUPIL-003` serves for a person the consent record withholds: both names `null`, the slot standing. */
const ZURUECKGEHALTEN: FLSpielerPublic = {
  id: "6890a1b2c3d4e5f607390032",
  vorname: null,
  nachname: null,
  nummer: "12",
  position: "Abwehr",
};

/** A forename a space runs through, which is the row a reader that split the DISPLAY string gave three letters. */
const ZWEITEILIGER_VORNAME: FLSpielerPublic = {
  id: "6890a1b2c3d4e5f607390033",
  vorname: "Anna Lena",
  nachname: "K.",
  nummer: "3",
  position: "Mittelfeld",
};

/* The back button reads `useRouter`, so the view renders under Next's contexts or its own import throws. */
const shown = (teamSpieler: FLSpielerPublic[]): void => {
  render(
    underNext(
      h(TeamSpielerView, {
        teamName: "FC Alpha",
        teamSpieler,
        saisonId: "2026",
        isFinishedSaison: false,
      }),
    ),
  );
};

describe("a squad row whose name the publication gate withheld", () => {
  it("reads the withheld word rather than an empty cell", () => {
    shown([ZURUECKGEHALTEN]);

    assert.ok(screen.getByText(SPIELER_ANONYM_LABEL), "the row renders no word at all where the names are null");
  });

  it("renders an avatar beside it rather than throwing on the null forename", () => {
    shown([ZURUECKGEHALTEN]);

    // The letter of the word shown, so nothing a stored name could supply reaches the avatar.
    assert.ok(screen.getByText(SPIELER_ANONYM_LABEL.charAt(0).toUpperCase()), "the avatar carries no letter for a withheld row");
  });

  it("keeps the number and the position the row still holds", () => {
    shown([ZURUECKGEHALTEN]);

    assert.ok(screen.getByText("12"), "the shirt went with the name");
    assert.ok(screen.getByText("Abwehr"), "the position went with the name");
  });

  it("leaves a published row reading exactly as it did", () => {
    shown([VEROEFFENTLICHT]);

    assert.ok(screen.getByText("Alina F."), "the forename and the initial stopped being joined");
    assert.ok(screen.getByText("AF"), "the avatar stopped carrying both letters");
  });

  it("gives a two-word forename the same two letters as any other row", () => {
    shown([ZWEITEILIGER_VORNAME]);

    assert.ok(screen.getByText("Anna Lena K."), "the forename and the initial stopped being joined");
    assert.ok(screen.getByText("AK"), "the avatar reads the display string rather than the two name fields");
  });

  /* The empty-value grade every page gives a word standing where a value would
     (`fl_frontend/src/shared/components/ui/Angabe.tsx :: Leer`), at the slot's own size and weight:
     the grade alone tells the stand-in word from a name, so the hierarchy holds. */
  it("sets the withheld word apart from a name by the grade alone, at a name's weight", () => {
    shown([VEROEFFENTLICHT, ZURUECKGEHALTEN]);

    const withheldWord = screen.getByText(SPIELER_ANONYM_LABEL);
    const slot = withheldWord.parentElement?.className.split(/\s+/) ?? [];
    const named = screen.getByText("Alina F.").className.split(/\s+/);

    assertLeer(withheldWord, SPIELER_ANONYM_LABEL);
    assert.ok(slot.includes("font-bold") && slot.includes("fluid-xs"), `the withheld word lost a name's size or weight: ${slot.join(" ")}`);
    assert.ok(named.includes("font-bold") && !named.includes("text-foreground-muted"), `a stored name lost its own grade: ${named.join(" ")}`);
  });

  /* Both rows in one table, which is what a squad holding one of each really serves: a case per row
     would pass against a view that read the first row's name for every row. */
  it("tells the two apart in one squad", () => {
    shown([VEROEFFENTLICHT, ZURUECKGEHALTEN]);

    assert.ok(screen.getByText("Alina F."), "the published row lost its name beside a withheld one");
    assert.ok(screen.getByText(SPIELER_ANONYM_LABEL), "the withheld row lost its word beside a published one");
  });
});

describe("a squad row holding no number and no position", () => {
  /* Each column's heading is its cell's label, the number's `#` included, so both empty cells take the
     labelled word. */
  it("reads both empty cells as „Nicht hinterlegt“ under their headings", () => {
    shown([{ ...VEROEFFENTLICHT, nummer: null, position: null }]);

    const leer = screen.getAllByText("Nicht hinterlegt");
    assert.equal(leer.length, 2, "the number and the position do not both read the labelled word");
    for (const cell of leer) assertLeer(cell, "Nicht hinterlegt");
  });
});
