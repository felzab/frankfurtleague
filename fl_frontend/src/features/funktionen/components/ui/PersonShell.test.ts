import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { Funktion } from "@/core/funktionen.ts";

doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness: the harness registers the
   resolver the icon package's bare `./x` imports need as it evaluates, and a static import resolves first. */
const { PersonShell } = await import("./PersonShell.tsx");
const { PERSON_SHELL_FALLBACK, PERSON_SIDEMENU_ENTRIES, personStructureFor } = await import("../../constants.ts");
const { personEintraegeOf } = await import("../../utils.ts");

const SPIELER: Funktion = { art: "spieler", spieler_id: "6890a1b2c3d4e5f607250001" };
const SCHIEDSRICHTER: Funktion = { art: "schiedsrichter", schiedsrichter_id: "6890a1b2c3d4e5f607250002" };

/** The labels the person shell lists for these Funktionen, in the order it lists them. */
const listedFor = (funktionen: Funktion[]): string[] =>
  personStructureFor(personEintraegeOf(funktionen)).flatMap((group) => group.sub_options.map((option) => option.label));

/** The shell as the person layout mounts it at one address, for a person holding every person-lane Funktion. */
const shellAt = (pathname: string): string =>
  renderTree(
    underNext(
      h(PersonShell, {
        structure: personStructureFor(personEintraegeOf([SPIELER, SCHIEDSRICHTER])),
        children: h("p", null, "Seiteninhalt"),
      }),
      { pathname },
    ),
  );

/** The page's one heading, which is what a screen reader lands on first and what WCAG 2.4.6 judges. */
function heading(html: string): string {
  const found = [...html.matchAll(/<h1[^>]*>(.*?)<\/h1>/gs)];
  assert.equal(found.length, 1, `the shell renders ${String(found.length)} h1 elements`);

  return textOf(found[0]?.[1] ?? "", " ")
    .replace(/\s+/g, " ")
    .trim();
}

describe("what the person shell lists", () => {
  /* A listed page the person may not open is a link the page turns away. */
  it("lists the person-lane pages a person holds and no other", () => {
    assert.deepEqual(listedFor([SPIELER]), [PERSON_SIDEMENU_ENTRIES.spieler.label]);
    assert.deepEqual(listedFor([SCHIEDSRICHTER]), [PERSON_SIDEMENU_ENTRIES.schiedsrichter.label]);
  });

  /* Listed where it offers a choice or is the only page there is, and never where it would send the
     person straight back to the page they pressed it from. */
  it("lists the landing exactly where it is a page of its own", () => {
    const landing = PERSON_SIDEMENU_ENTRIES.landing.label;

    assert.ok(!listedFor([SPIELER]).includes(landing), "one Funktion's holder is offered a landing that sends them back");
    assert.deepEqual(listedFor([SPIELER, SCHIEDSRICHTER]), [
      landing,
      PERSON_SIDEMENU_ENTRIES.spieler.label,
      PERSON_SIDEMENU_ENTRIES.schiedsrichter.label,
    ]);
    assert.deepEqual(listedFor([]), [landing]);
  });
});

describe("the heading the person shell puts over a page", () => {
  it("names the landing by its own entry rather than as an unknown address", () => {
    assert.equal(heading(shellAt("/bereich")), PERSON_SIDEMENU_ENTRIES.landing.label);
  });

  /* The account page sits under each Funktion's word and is reached from the bar, so it takes that
     Funktion's heading and names itself in its own, as an admin detail page does. */
  it("names a Funktion's page and every page beneath it by that Funktion", () => {
    assert.equal(heading(shellAt("/bereich/spieler")), PERSON_SIDEMENU_ENTRIES.spieler.label);
    assert.equal(heading(shellAt("/bereich/spieler/konto")), PERSON_SIDEMENU_ENTRIES.spieler.label);
    assert.equal(heading(shellAt("/bereich/schiedsrichter/konto")), PERSON_SIDEMENU_ENTRIES.schiedsrichter.label);
  });

  /* The catch-all's 404. Headed as a page, it tells a screen reader it is somewhere it is not. */
  it("names no page over an address that belongs to none", () => {
    const html = shellAt("/bereich/zorbanax");

    assert.equal(heading(html), PERSON_SHELL_FALLBACK.label);
    assert.ok(html.includes("Seiteninhalt"), "the shell does not render the page it heads");
  });
});
