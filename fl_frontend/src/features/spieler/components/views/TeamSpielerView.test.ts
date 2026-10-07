import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

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
     (`fl_frontend/src/shared/components/ui/Angabe.tsx :: Leer`), below a name's weight: at a name's
     weight the stand-in word reads as somebody's name rather than as the state it is. */
  it("sets the withheld word apart from a name, and leaves a published one at a name's grade", () => {
    shown([VEROEFFENTLICHT, ZURUECKGEHALTEN]);

    const withheldWord = screen.getByText(SPIELER_ANONYM_LABEL);
    const withheld = withheldWord.className.split(/\s+/);
    const slot = withheldWord.parentElement?.className.split(/\s+/) ?? [];
    const named = screen.getByText("Alina F.").className.split(/\s+/);

    assert.ok(withheld.includes("text-foreground-muted"), `the withheld word keeps a name's ink: ${withheld.join(" ")}`);
    assert.ok(!withheld.includes("italic"), `the withheld word is slanted: ${withheld.join(" ")}`);
    assert.ok(!slot.includes("font-bold"), `the withheld word keeps a name's weight: ${slot.join(" ")}`);
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
  /* The number column is headed by a glyph, so its cell names the field; the position column's
     heading names its own, so that cell takes the labelled word. */
  it("names the empty number and leaves the empty position to its heading", () => {
    shown([{ ...VEROEFFENTLICHT, nummer: null, position: null }]);

    for (const leer of ["Nummer nicht hinterlegt", "Nicht hinterlegt"]) {
      const grade = screen.getByText(leer).className.split(/\s+/);
      assert.ok(
        grade.includes("text-foreground-muted") && !grade.includes("italic"),
        `„${leer}“ is not in the empty grade: ${grade.join(" ")}`,
      );
    }
  });
});
