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
const { funktionOrteOf, personEintraegeOf } = await import("../../utils.ts");

const SPIELER: Funktion = { art: "spieler", spieler_id: "6890a1b2c3d4e5f607250001" };
const SCHIEDSRICHTER: Funktion = { art: "schiedsrichter", schiedsrichter_id: "6890a1b2c3d4e5f607250002" };

/** The labels the person shell lists for these Funktionen, in the order it lists them. */
const listedFor = (funktionen: Funktion[]): string[] =>
  personStructureFor(personEintraegeOf(funktionen)).flatMap((group) => group.sub_options.map((option) => option.label));

/**
 * The shell as the person layout mounts it at one address, for a person holding every person-lane
 * Funktion, arrived at with a season in the query as a link from the admin's shell carries one.
 */
const shellAt = (pathname: string): string =>
  renderTree(
    underNext(
      h(PersonShell, {
        structure: personStructureFor(personEintraegeOf([SPIELER, SCHIEDSRICHTER])),
        orte: funktionOrteOf([SPIELER, SCHIEDSRICHTER]),
        children: h("p", null, "Seiteninhalt"),
      }),
      { pathname, search: "saison_id=2526" },
    ),
  );

/** Every link the markup offers, each as its href and whether it marks the current page. */
const linksIn = (html: string): { href: string; current: boolean; text: string }[] =>
  [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map(([, attributes = "", inner = ""]) => ({
    href: /\bhref="([^"]*)"/.exec(attributes)?.[1] ?? "",
    current: /\baria-current="page"/.test(attributes),
    text: textOf(inner, " ").replace(/\s+/g, " ").trim(),
  }));

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

describe("the links the person shell offers", () => {
  /* The landing's entry is the prefix itself, so it is current there and nowhere below it. */
  it("marks the landing's entry current on /bereich alone, linking to the prefix itself", () => {
    const landing = PERSON_SIDEMENU_ENTRIES.landing.label;
    const entry = (pathname: string) => linksIn(shellAt(pathname)).find((link) => link.text === landing);

    assert.deepEqual(entry("/bereich"), { href: "/bereich", current: true, text: landing });
    assert.equal(entry("/bereich/spieler")?.current, false, "the landing's entry is current on a page below it");
    assert.ok(!linksIn(shellAt("/bereich")).some((link) => link.href === "/bereich/"), "an entry links to /bereich/ rather than the prefix");
  });

  /* A person's pages are scoped to the person, so a season the address arrived with rides no link on. */
  it("carries no season on any link, whatever the address arrived with", () => {
    const links = linksIn(shellAt("/bereich"));

    // The control: an empty list passes the absence below unread.
    assert.ok(
      links.some((link) => link.href.startsWith("/bereich")),
      "the shell renders no link into the area at all",
    );
    assert.deepEqual(
      links.filter((link) => link.href.includes("saison_id")),
      [],
      "these links carry a season the person area never reads",
    );
  });
});

describe("the heading the person shell puts over a page", () => {
  it("names the landing by its own entry rather than as an unknown address", () => {
    assert.equal(heading(shellAt("/bereich")), PERSON_SIDEMENU_ENTRIES.landing.label);
  });

  it("names a Funktion's page by that Funktion", () => {
    assert.equal(heading(shellAt("/bereich/spieler")), PERSON_SIDEMENU_ENTRIES.spieler.label);
    assert.equal(heading(shellAt("/bereich/schiedsrichter")), PERSON_SIDEMENU_ENTRIES.schiedsrichter.label);
  });

  /* The catch-all's 404. Headed as a page, it tells a screen reader it is somewhere it is not. */
  it("names no page over an address that belongs to none", () => {
    const html = shellAt("/bereich/zorbanax");

    assert.equal(heading(html), PERSON_SHELL_FALLBACK.label);
    assert.ok(html.includes("Seiteninhalt"), "the shell does not render the page it heads");
  });
});
