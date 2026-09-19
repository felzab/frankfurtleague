import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* No public export carries either context — `Link` reads the first and `useSearchParams` the second —
   and every list renders under both. A Next release that moves either module fails this file at import. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { IDENTITY_NAME, identityName } from "@/shared/components/ui/adminTable.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas.ts";
import type { AdminSpielerRow } from "@/features/spieler/types.ts";
import type { FLSpielort } from "@/features/spielorte/schemas.ts";
import type { AdminTeamRow } from "@/features/teams/types.ts";
import type { ReactNode } from "react";

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminSchiedsrichterTable } = await import("@/features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx");
const { AdminSpielerTable } = await import("@/features/spieler/components/collections/AdminSpielerTable.tsx");
const { AdminSpielorteTable } = await import("@/features/spielorte/components/collections/AdminSpielorteTable.tsx");
const { AdminTeamsTable } = await import("@/features/teams/components/collections/AdminTeamsTable.tsx");

const STILLGELEGT_AM = "2026-09-09";

const ROUTER = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "retiredRows",
};

const markup = (list: ReactNode): string =>
  renderTree(
    h(AppRouterContext.Provider, { value: ROUTER }, h(SearchParamsContext.Provider, { value: new URLSearchParams("saison_id=2026") }, list)),
  );

const club = (id: string, name: string, inactiveSince: string | null): AdminTeamRow => ({
  id,
  name,
  full_name: `${name} Gymnasium`,
  shorthand: name.slice(0, 2).toUpperCase(),
  inactive_since: inactiveSince,
  selected: { gruppe: "A", austritt: null },
  isRetireable: false,
  publicSaisonId: null,
});

const person = (id: string, vorname: string, inactiveSince: string | null): AdminSpielerRow => ({
  id,
  vorname,
  nachname: "Meier",
  fullName: `${vorname} Meier`,
  inactive_since: inactiveSince,
  selected: null,
});

const ort = (id: string, name: string, inactiveSince: string | null): FLSpielort => ({
  id,
  name,
  address: { strasse: "Feldweg", hausnummer: "3", plz: "60437", stadtteil: "", stadt: "Frankfurt am Main" },
  maps_link: `${name}, Feldweg 3, 60437 Frankfurt am Main`,
  default_mietpreis: 40,
  inactive_since: inactiveSince,
});

const referee = (id: string, name: string, inactiveSince: string | null): FLSchiedsrichter => ({
  id,
  name,
  schule: "Carl-Schurz-Schule",
  default_payment: 20,
  kontakt: { telefon: "069 1234567", email: "kontakt@example.com" },
  inactive_since: inactiveSince,
  anonymisiert_am: null,
});

type Liste = { live: string; retired: string; html: string };

/** Each list with one live row and one retired row, keyed by the component's own module name. */
const LISTS: Record<string, Liste> = {
  AdminTeamsTable: {
    live: "Goethe",
    retired: "Lessing",
    html: markup(
      h(AdminTeamsTable, {
        filteredTeams: [club("t1", "Goethe", null), club("t2", "Lessing", STILLGELEGT_AM)],
        emptiness: "none",
        setDeletingTeam: () => undefined,
      }),
    ),
  },
  AdminSpielerTable: {
    live: "Jule Meier",
    retired: "Lena Meier",
    html: markup(
      h(AdminSpielerTable, {
        filteredSpieler: [person("s1", "Jule", null), person("s2", "Lena", STILLGELEGT_AM)],
        emptiness: "none",
        saisonTeams: [],
        selectedSaisonId: "2026",
        setDeletingSpieler: () => undefined,
      }),
    ),
  },
  AdminSpielorteTable: {
    live: "Sportplatz Ost",
    retired: "Halle West",
    html: markup(
      h(AdminSpielorteTable, {
        filteredSpielorte: [ort("o1", "Sportplatz Ost", null), ort("o2", "Halle West", STILLGELEGT_AM)],
        emptiness: "none",
        setDeletingOrt: () => undefined,
      }),
    ),
  },
  AdminSchiedsrichterTable: {
    live: "Anna Körner",
    retired: "Ben Vogt",
    html: markup(
      h(AdminSchiedsrichterTable, {
        filteredSchiedsrichter: [referee("r1", "Anna Körner", null), referee("r2", "Ben Vogt", STILLGELEGT_AM)],
        emptiness: "none",
        setDeletingSchiedsrichter: () => undefined,
      }),
    ),
  },
};

/**
 * Every admin list drawing the „Stillgelegt“ pill, found by its import rather than by the recipe this
 * file asserts: a list spelling its own fade drops out of a population read off `identityName`.
 */
function listsDrawingRetiredRows(): string[] {
  const features = path.resolve(import.meta.dirname, "..");

  return readdirSync(features)
    .map((slice) => path.join(features, slice, "components", "collections"))
    .filter((dir) => existsSync(dir))
    .flatMap((dir) =>
      readdirSync(dir)
        .filter((file) => file.endsWith(".tsx"))
        .filter((file) => readFileSync(path.join(dir, file), "utf8").includes('from "@/shared/components/ui/RetiredBadge"'))
        .map((file) => file.replace(/\.tsx$/, "")),
    )
    .sort();
}

/**
 * Every class token the markup carries whose utility, variants stripped, fades what it sits on.
 * `opacity-100` is spared: it composites nothing, and a wrapper sets it to cancel a component's own dimming.
 */
const fades = (html: string): string[] =>
  [...html.matchAll(/\sclass="([^"]*)"/g)]
    .flatMap((treffer) => (treffer[1] ?? "").split(/\s+/))
    .filter((token) => /^opacity-(?!100$)/.test(token.split(":").at(-1) ?? ""));

/** How many times one name is drawn with exactly this class list. */
const drawn = (html: string, classes: string, name: string): number => html.split(`<span class="${classes}">${name}</span>`).length - 1;

describe("a retired row on an admin list", () => {
  /* First: a list that stopped importing the pill, or one added beside these four, would otherwise
     leave the cases below reading a population nobody chose. */
  it("is asserted on every list that draws one", () => {
    assert.deepEqual(Object.keys(LISTS).sort(), listsDrawingRetiredRows());
  });

  /* The reader has to be able to fail, on a row wrapper and on a card behind a breakpoint alike. */
  it("reads a fade on any element, behind any variant", () => {
    assert.deepEqual(fades(`<div class="flex opacity-60"><div class="md:opacity-80 opacity-100"></div></div>`), [
      "opacity-60",
      "md:opacity-80",
    ]);
  });

  /* An opacity composites every line and pill in the row with the ground under it, and the muted lines
     and the „Stillgelegt“ pill then measure under WCAG 1.4.3's 4.5:1. */
  it("is faded by no element in either layout", () => {
    for (const [list, { html }] of Object.entries(LISTS)) assert.deepEqual(fades(html), [], `${list} fades an element`);
  });

  /* Both layouts draw the name, so each list draws it twice; a count of one is a layout spelling the
     name its own way, and the table and its phone card then disagree about the row. */
  it("draws its name in the shared retired ink in both layouts, and a live row's in the shared live ink", () => {
    assert.notEqual(identityName(true), identityName(false), "a retired row's name reads exactly like a live one's");
    assert.equal(identityName(false), IDENTITY_NAME);

    for (const [list, { live, retired, html }] of Object.entries(LISTS)) {
      assert.equal(drawn(html, identityName(true), retired), 2, `${list} draws the retired row's name in some other ink`);
      assert.equal(drawn(html, IDENTITY_NAME, live), 2, `${list} draws the live row's name in some other ink`);
    }
  });
});
