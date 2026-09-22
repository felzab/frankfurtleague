import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { SCHIEDSRICHTER_ANONYM_LABEL } from "@/features/schiedsrichter/constants.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderMarkup, renderTree, textOf } from "@/shared/testing/renderTest.ts";

import {
  ALREADY_IN_SAISON,
  ERASURE_NEEDS_RETIREMENT,
  RETIREMENT_CONSEQUENCE,
  RETIREMENT_KEEPS_SQUAD_ROWS,
  SPIELER_ANONYM_LABEL,
  spielerAnzeigename,
} from "./constants.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { FormAustragenSection } = await import("./components/forms/AdminSpielerEditForm/FormAustragenSection.tsx");
const { FormLoeschenSection } = await import("./components/forms/AdminSpielerEditForm/FormLoeschenSection.tsx");

/**
 * A masculine word standing for the pupil: the demonstrative on the noun, the possessive, and the
 * third-person pronoun. The noun's own article is not one — `Der Spieler` names the record.
 */
const MASKULIN = /\bdieser spieler\b|\bsein(?:e|em|en|er|es)?\b|\b(?:er|ihn|ihm)\b/i;

/** The sentences a reader hears, with the markup taken out and the JSX line breaks collapsed. */
const read = (html: string): string => textOf(html).replace(/\s+/g, " ").trim();

const acrossContexts = (element: Parameters<typeof renderTree>[0]): string => renderTree(underNext(element));

describe("the squad-row panel a player is taken out of a season on", () => {
  const shown = (): string =>
    read(
      renderMarkup(FormAustragenSection, {
        spielerId: "68c1f0a2b3c4d5e6f7a8b9c0",
        saisonId: "2026",
        rowInactiveSince: null,
        rowReturn: "open",
        banners: [],
      }),
    );

  /* The row and the person are two subjects here, and the surviving `sein` belongs to the row: it is
     the entry's club that a replacement can take out of the season. */
  it("hangs the condition on the Kadereintrag rather than on the pupil", () => {
    const text = shown();

    assert.match(text, /Der Kadereintrag bleibt gespeichert/, "the entry stopped being the sentence's subject");
    assert.match(text, /solange sein Team in der Saison dabei ist/, "the copy states no condition at all");
    assert.ok(!/\bSein Eintrag\b/.test(text), "the entry is the pupil's possession again");
  });
});

describe("the erasure panel", () => {
  const shown = (isRetired: boolean): string =>
    read(
      acrossContexts(
        h(FormLoeschenSection, { spielerId: "68c1f0a2b3c4d5e6f7a8b9c0", fullName: "Lena Bergmann", isRetired: isRetired, membershipCount: 2 }),
      ),
    );

  it("names the pupil as this panel's own prose already does, in both of its arms", () => {
    const gesperrt = shown(false);

    assert.match(gesperrt, /Diese Person ist nicht stillgelegt/, "the notice heads the refusal with a masculine demonstrative");
    assert.ok(gesperrt.includes(ERASURE_NEEDS_RETIREMENT), "the notice no longer carries the repair the action toasts");
    // Both arms, the offered one being where the press actually stands.
    for (const [arm, text] of [
      ["the blocked arm", gesperrt],
      ["the offered arm", shown(true)],
    ] as const) {
      assert.doesNotMatch(text, MASKULIN, `${arm}: the panel names the pupil with a masculine word`);
    }
  });
});

describe("the retirement dialog's second step", () => {
  it("names the pupil neutrally in the consequence it escalates to", () => {
    assert.match(RETIREMENT_CONSEQUENCE, /Die Kadereinträge dieser Person bleiben/, "the consequence stopped naming what survives");
    assert.doesNotMatch(RETIREMENT_CONSEQUENCE, MASKULIN, "the consequence names the pupil with a masculine word");
  });
});

describe("the sentences the player's own write paths answer with", () => {
  it("names the pupil neutrally in each of them", () => {
    const namedMasculine: string[] = [];

    for (const [where, sentence] of [
      ["the duplicate squad row", ALREADY_IN_SAISON],
      ["the retirement", RETIREMENT_KEEPS_SQUAD_ROWS],
    ] as const) {
      if (MASKULIN.test(sentence)) namedMasculine.push(where);
    }

    assert.deepEqual(namedMasculine, [], "an answer names the pupil with a masculine word");
  });

  /* The repair the erasure refusal points at, which the panel above renders and the action toasts. */
  it("names the pupil neutrally in the erasure's precondition", () => {
    assert.doesNotMatch(ERASURE_NEEDS_RETIREMENT, MASKULIN, "the repair names the pupil with a masculine word");
    assert.match(ERASURE_NEEDS_RETIREMENT, /in ihrer Zeile/, "the repair stopped saying which row holds the control");
  });
});

describe("the word a person absent from a public page is named by", () => {
  /* Equal by decision: a reader cannot tell a withheld name from a deleted person, so the page keeps
     the two apart nowhere and the storage keeps them apart instead. */
  it("is the same for a withheld pupil and an erased referee", () => {
    assert.equal(SPIELER_ANONYM_LABEL, SCHIEDSRICHTER_ANONYM_LABEL, "one of the two words was edited without the other");
  });

  it("is reached through the null name the gate serves, on a row that is still stored", () => {
    assert.equal(spielerAnzeigename({ vorname: null, nachname: null }), SPIELER_ANONYM_LABEL);
    assert.equal(spielerAnzeigename({ vorname: "Alina", nachname: "F." }), "Alina F.");
  });

  it("is never reached for a person whose surname alone is absent", () => {
    assert.equal(spielerAnzeigename({ vorname: "Alina", nachname: null }), "Alina");
  });
});
