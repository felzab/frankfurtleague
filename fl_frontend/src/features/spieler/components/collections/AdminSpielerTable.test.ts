import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `Link` reads the first and `useSearchParams` the second
   — and the table renders under both. A Next release that moves either module fails this file at
   import. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { labelBadge } from "@/shared/components/ui/badges.ts";
import { renderTree, textOf } from "@/shared/testing/renderTest.ts";

import type { AdminSpielerRow, SpielerTeamOption } from "../../types.ts";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminSpielerTable } = await import("./AdminSpielerTable.tsx");

/** The gap each dated pill spells as `&nbsp;`, which a render emits as the character itself. */
const NBSP = "\u00A0";

const TEAM: SpielerTeamOption = { teamId: "6890a1b2c3d4e5f607910001", name: "Carl-Schurz-Schule", shorthand: "CSS" };

/** The person is retired and in no squad this season, which is the pair of pills that state carries. */
const STILLGELEGT: AdminSpielerRow = {
  id: "6890a1b2c3d4e5f607900001",
  vorname: "Lena",
  nachname: "Meier",
  fullName: "Lena Meier",
  inactive_since: "2026-09-09",
  selected: null,
};

const SQUAD = {
  team_id: TEAM.teamId,
  nummer: "7",
  position: "Angriff",
  stufe: "Q2",
  is_nachgetragen: false,
  rolle: "kapitaen",
  inactive_since: "2026-09-09",
  teamName: TEAM.name,
  teamShorthand: TEAM.shorthand,
} as const;

/** The squad row came out of the season while the person stayed, which is the other retirement. */
const AUSGETRAGEN: AdminSpielerRow = {
  id: "6890a1b2c3d4e5f607900002",
  vorname: "Mara",
  nachname: "Falk",
  fullName: "Mara Falk",
  inactive_since: null,
  selected: SQUAD,
};

/** Live on both counts and added after kick-off, which is the state the other two cannot reach. */
const NACHGETRAGEN: AdminSpielerRow = {
  id: "6890a1b2c3d4e5f607900003",
  vorname: "Jule",
  nachname: "Roth",
  fullName: "Jule Roth",
  inactive_since: null,
  selected: { ...SQUAD, rolle: "co_kapitaen", is_nachgetragen: true, inactive_since: null },
};

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "",
};

const table = (rows: AdminSpielerRow[]): string =>
  renderTree(
    h(
      AppRouterContext.Provider,
      { value: ROUTER },
      h(
        SearchParamsContext.Provider,
        { value: new URLSearchParams("saison_id=2026") },
        h(AdminSpielerTable, {
          filteredSpieler: rows,
          emptiness: "none" as const,
          saisonTeams: [TEAM],
          selectedSaisonId: "2026",
          setDeletingSpieler: () => undefined,
        }),
      ),
    ),
  );

/** Derived rather than typed here, so the pill finder tracks `labelBadge` when the recipe changes. */
const PILL_CLASSES = labelBadge("info")
  .split(" ")
  .filter((token) => labelBadge("danger").split(" ").includes(token));

/**
 * Every distinct pill in the markup, as the text it renders. A dated pill nests the date's own span,
 * so the first `</span>` after the opening tag is not the pill's close.
 */
function pillsIn(html: string): string[] {
  const found = new Set<string>();
  const opening = /<span\b[^>]*\bclass="([^"]*)"[^>]*>/g;

  for (let pill = opening.exec(html); pill !== null; pill = opening.exec(html)) {
    const classes = (pill[1] ?? "").split(" ");
    if (!PILL_CLASSES.every((token) => classes.includes(token))) continue;

    const tags = /<\/?span\b[^>]*>/g;
    tags.lastIndex = opening.lastIndex;
    let depth = 1;
    for (let tag = tags.exec(html); tag !== null && depth > 0; tag = tags.exec(html)) {
      depth += tag[0].startsWith("</") ? -1 : 1;
      if (depth === 0) found.add(textOf(html.slice(opening.lastIndex, tag.index)));
    }
  }

  return [...found].sort();
}

/**
 * Every pill a row can draw. The identity column leaves one 147px at the narrowest table width
 * (`fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts` carries that column arithmetic), and
 * a pill is `whitespace-nowrap`, so a string past that width lands on the Position cell.
 */
const PILLS: readonly string[] = [
  `Ausgetragen${NBSP}09.09.2026`,
  `Stillgelegt${NBSP}09.09.2026`,
  "Nicht im Kader",
  "Nachgetragen",
  "Co-Kapitän",
  "Kapitän",
  "Aktiv",
];

describe("the pills a Spieler row draws", () => {
  /* The roster is where each of these was last read against the column, so a string that is not on it
     is one with no measured width behind it. */
  it("are the ones this roster names, an edited one arriving unmeasured", () => {
    const drawn = pillsIn(table([STILLGELEGT, AUSGETRAGEN, NACHGETRAGEN]));

    assert.deepEqual(drawn, [...PILLS].sort());
  });
});
