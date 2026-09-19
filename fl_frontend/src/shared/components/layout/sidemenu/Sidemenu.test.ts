import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { SidemenuStructure } from "@/shared/types/types";

/* Reached with `await import` and never a static import beside the harness
   (`docs/frontend/spec.md` §1.9), the icon package too: its ESM imports `./x` bare, which only the
   harness's resolver completes. */
const { Sidemenu } = await import("./Sidemenu.tsx");
const { Calendar, Magnifier, Persons } = await import("@gravity-ui/icons");

const ICONS = { Calendar, Magnifier, Persons };

/* Both rails render through this one component, so a structure of its shape stands for either: two
   groups, one of them unnamed, and more than one link in a group. */
const STRUCTURE: SidemenuStructure<keyof typeof ICONS> = [
  {
    category_name: "Spiele",
    sub_options: [
      { id: "spielplan", label: "Spielplan", iconName: "Calendar", hint: { lead: "Probe." } },
      { id: "spielsuche", label: "Spielsuche", iconName: "Magnifier", hint: { lead: "Probe." } },
    ],
  },
  { category_name: "", sub_options: [{ id: "teams", label: "Teams", iconName: "Persons", hint: { lead: "Probe." } }] },
];

const LABELS = STRUCTURE.flatMap((group) => group.sub_options.map((option) => option.label));

function rail(isDesktopCollapsed: boolean): string {
  return renderTree(
    underNext(
      h(Sidemenu, {
        structure: STRUCTURE,
        linkPrefix: "/dashboard",
        saisonMetadataDisplay: null,
        iconDictionary: ICONS,
        pathname: "/dashboard/spielplan",
        isMobileOpen: false,
        onMobileClose: () => undefined,
        isDesktopCollapsed,
        onToggleDesktopMenu: () => undefined,
      }),
      { search: "saison_id=2526", pathname: "/dashboard/spielplan" },
    ),
  );
}

const STATES = [
  ["expanded", rail(false)],
  ["collapsed", rail(true)],
] as const;

const COLLAPSED = STATES[1][1];

const tokensOf = (openingTag: string): string[] => (/\sclass="([^"]*)"/.exec(openingTag)?.[1] ?? "").split(" ");

/** Every element the markup opens, as its opening tag, carrying a class token `matches` accepts. */
const openingTagsWith = (markup: string, matches: (token: string) => boolean): string[] =>
  [...markup.matchAll(/<[a-z]+\b[^>]*>/g)].map((hit) => hit[0]).filter((tag) => tokensOf(tag).some(matches));

/** Each link's accessible name: its `aria-label`, or failing one the text inside it. */
function linkNames(markup: string): { tag: string; name: string }[] {
  return [...markup.matchAll(/(<a\b[^>]*>)([\s\S]*?)<\/a>/g)].map(([, tag, inner]) => ({
    tag: tag!,
    name: (/\saria-label="([^"]*)"/.exec(tag!)?.[1] ?? inner!.replace(/<[^>]*>/g, "")).trim(),
  }));
}

describe("what the rail tells assistive tech", () => {
  /* Collapsed, a link holds nothing but a hidden glyph, and the tooltip beside it is no name: a
     screen reader announces „Link“ and nothing else (WCAG 2.4.4, 4.1.2). */
  it("names every link in either state", () => {
    for (const [state, markup] of STATES) {
      const links = linkNames(markup);

      assert.ok(
        links.length > LABELS.length,
        `the ${state} rail renders ${String(links.length)} links, fewer than its structure and footer hold`,
      );
      assert.deepEqual(
        links.filter((link) => link.name === "").map((link) => link.tag),
        [],
        `these ${state} links carry no accessible name`,
      );

      for (const label of LABELS) {
        assert.ok(
          links.some((link) => link.name === label),
          `no ${state} link is named ${label}, so its entry is announced by something other than its label`,
        );
      }
    }
  });
});

describe("how the rail's two halves line up", () => {
  /* Only the nav scrolls, so a strip it reserves alone leaves the footer's rows ending a scrollbar's
     width to the right of the links above them. */
  it("declares one scrollbar gutter, the same one, on both halves", () => {
    for (const [state, markup] of STATES) {
      const reserving = openingTagsWith(markup, (token) => token.startsWith("scrollbar-gutter-"));
      const strips = reserving.map((tag) => tokensOf(tag).find((token) => token.startsWith("scrollbar-gutter-")));

      assert.equal(
        reserving.length,
        2,
        `the ${state} rail declares a gutter on ${String(reserving.length)} boxes rather than on its nav and its footer`,
      );
      assert.equal(strips[0], strips[1], `the ${state} rail's halves declare different gutters: ${strips.join(" and ")}`);

      // `scrollbar-gutter` reserves nothing on a box that does not clip its overflow.
      for (const tag of reserving) {
        assert.ok(
          tokensOf(tag).some((token) => /^overflow(-y)?-(auto|hidden|scroll)$/.test(token)),
          `${tag} names a gutter beside no overflow token`,
        );
      }
    }
  });

  /* Collapsed, the column the rule sits in is narrower than the squares under it, so a fraction of
     that column draws a rule half a glyph wide. */
  it("gives a collapsed group's rule the width token its glyph's size names", () => {
    // A nav link's own glyph: the drawer's close control and the footer draw theirs at other sizes.
    const glyph = new RegExp(`<a\\b[^>]*aria-label="${LABELS[0]!}"[^>]*>\\s*(<svg\\b[^>]*>)`).exec(COLLAPSED)?.[1];
    const rules = [...COLLAPSED.matchAll(/<hr\b[^>]*>/g)].map((hit) => hit[0]);
    // Throw rather than compare against undefined, which every rule below would fail for the wrong reason.
    if (glyph === undefined) throw new Error("the collapsed rail renders no sized glyph to measure a rule against");

    const glyphSize = tokensOf(glyph)
      .find((token) => token.startsWith("size-"))!
      .slice("size-".length);

    assert.equal(
      rules.length,
      STRUCTURE.length,
      `the collapsed rail draws ${String(rules.length)} rules for ${String(STRUCTURE.length)} groups`,
    );
    for (const rule of rules) {
      assert.ok(
        tokensOf(rule).includes(`w-${glyphSize}`),
        `the collapsed rule is ${rule}, which does not carry the glyph's \`w-${glyphSize}\``,
      );
    }
  });

  /* Collapsed, both halves' strips leave a clip box barely wider than a square, so a focus ring drawn
     outside the square loses both its sides to the clip. */
  it("names an inset focus ring on every collapsed square", () => {
    const squares = openingTagsWith(COLLAPSED, (token) => token === "w-9");

    assert.ok(
      squares.length > LABELS.length,
      `the collapsed rail renders ${String(squares.length)} squares, fewer than its links and controls`,
    );
    assert.deepEqual(
      squares.filter((tag) => !tokensOf(tag).some((token) => token === "-outline-offset-2" || token === "ring-inset")),
      [],
      "these collapsed squares name neither inset ring token",
    );
  });
});
