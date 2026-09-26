import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { Funktion } from "@/core/funktionen.ts";

/* Reached with `await import` and never a static import beside the harness: the harness registers the
   resolver the icon package's bare `./x` imports need as it evaluates, and a static import resolves first. */
const { TeamForbiddenPanel } = await import("./TeamForbiddenPanel.tsx");
const { NAME_WRAP_CLASSES } = await import("@/shared/components/ui/nameWrap.ts");

const TEAM_A = "6890a1b2c3d4e5f607250011";
const TEAM_B = "6890a1b2c3d4e5f607250012";

const seat = (fields: Partial<Extract<Funktion, { art: "kontakt" }>> = {}): Funktion => ({
  art: "kontakt",
  rolle: "ansprechperson",
  team_id: TEAM_A,
  saison_id: "2526",
  team_name: "Goethe-Gymnasium",
  saison_status: "active",
  ...fields,
});

/** A seat at a second team, so the panel offers two ways out whatever else the person holds. */
const LESSING = seat({ team_id: TEAM_B, team_name: "Lessing-Gymnasium" });
const SPIELER: Funktion = { art: "spieler", spieler_id: TEAM_B };
const SCHIEDSRICHTER: Funktion = { art: "schiedsrichter", schiedsrichter_id: TEAM_B };
const ADMINISTRATION: Funktion = { art: "administration" };

const BEREICH = { href: "/bereich", text: "Zu Deinem Bereich" };
const GOETHE = { href: `/bereich/team/${TEAM_A}/2526`, text: "Goethe-Gymnasium, Saison 2526" };

/** Each way out the panel offers a person holding `funktionen`: its opening tag, its address and its text. */
function waysOut(funktionen: Funktion[]): { tag: string; href: string; text: string }[] {
  const markup = renderTree(h(TeamForbiddenPanel, { funktionen: funktionen }));

  return [...markup.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map(([, tag, inner]) => ({
    tag: tag!,
    href: /\shref="([^"]*)"/.exec(tag!)?.[1] ?? "",
    text: textOf(inner!, " ").trim(),
  }));
}

const addressesOf = (funktionen: Funktion[]) => waysOut(funktionen).map(({ href, text }) => ({ href, text }));

const classesOf = (tag: string): string[] => (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(" ");

describe("where the forbidden panel sends the person", () => {
  it("sends a person holding seats alone to those seats", () => {
    assert.deepEqual(addressesOf([seat()]), [GOETHE]);
  });

  /* A player's, a referee's and the administration's pages open through the person's own area, so each
     beside a seat adds the way there, and every Funktion stays reachable from the refusal. */
  it("adds the way to the person's own area beside the seats for every Funktion that is no seat", () => {
    for (const other of [SPIELER, SCHIEDSRICHTER, ADMINISTRATION]) {
      assert.deepEqual(addressesOf([seat(), other]), [GOETHE, BEREICH], `a ${other.art} Funktion beside a seat is left unreachable`);
    }
  });

  it("sends a person holding no seat to their own area alone", () => {
    for (const funktionen of [[], [SPIELER], [SCHIEDSRICHTER], [ADMINISTRATION]]) {
      assert.deepEqual(addressesOf(funktionen), [BEREICH]);
    }
  });

  /* Two seats at one team and season are one panel, and a second team or season is another. */
  it("offers one way out per address the person holds a seat at", () => {
    const funktionen = [seat({ rolle: "trainer" }), seat(), seat({ team_id: TEAM_B, team_name: "Lessing-Gymnasium" })];

    assert.deepEqual(
      addressesOf(funktionen).map(({ href }) => href),
      [`/bereich/team/${TEAM_A}/2526`, `/bereich/team/${TEAM_B}/2526`],
    );
  });
});

describe("how the forbidden panel draws its ways out", () => {
  /* A sole way out wears the brand fill at its own width, as `ShellNotFound` and `DashboardError` show
     theirs; several are peers in the outline grade, stacked at the panel's width. */
  it("grades a sole way out as the one on offer and several as peers", () => {
    const [sole] = waysOut([seat()]);
    assert.ok(sole !== undefined, "the panel offers no way out");
    assert.ok(classesOf(sole.tag).includes("bg-brand-solid"), "a sole way out is not in the brand fill");

    for (const peer of waysOut([seat(), LESSING])) {
      assert.ok(classesOf(peer.tag).includes("border-border"), `${peer.text} is not in a peer's outline grade`);
      assert.ok(!classesOf(peer.tag).includes("bg-brand-solid"), `${peer.text} is ranked above its peers`);
    }
  });

  it("sets a sole way out at its own width", () => {
    const markup = renderTree(h(TeamForbiddenPanel, { funktionen: [seat()] }));
    const [, before = ""] = /<p class="[^"]*">[^<]*<\/p>([\s\S]*?)<a\b/.exec(markup) ?? [];

    assert.doesNotMatch(before, /\bw-full\b/, "the sole way out sits in a box stretching it to the panel's width");
    assert.ok(!classesOf(waysOut([seat()])[0]!.tag).includes("w-full"), "the sole way out stretches to the panel's width");
  });

  /* A club's name is whatever the club is called: fixed at the recipe's height, a second line at a phone's
     width runs out through the button's edge. */
  it("lets a club's name wrap inside its way out", () => {
    const longName = seat({ team_name: "Städtisches Gymnasium Nord mit bilingualem Zweig" });
    const markup = renderTree(h(TeamForbiddenPanel, { funktionen: [longName, LESSING] }));

    for (const { tag } of waysOut([longName, LESSING])) {
      assert.ok(classesOf(tag).includes("whitespace-normal"), `${tag} cannot wrap its label`);
      assert.ok(!classesOf(tag).includes("h-12"), `${tag} fixes a height a wrapped label runs out of`);
    }
    assert.ok(
      markup.includes(`<span class="${NAME_WRAP_CLASSES}">Städtisches Gymnasium Nord`),
      "the name does not wrap as the neighbours wrap one",
    );
  });
});
