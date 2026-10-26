import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { IDENTITY_NAME_CLASSES, identityName } from "@/shared/components/ui/adminTable.ts";
import { doubleEveryAction } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderTree } from "@/shared/testing/renderTest.ts";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas.ts";
import type { AdminSpielerRow } from "@/features/spieler/types.ts";
import type { FLSpielort } from "@/features/spielorte/schemas.ts";
import type { AdminTeamRow } from "@/features/teams/types.ts";
import type { ReactNode } from "react";

doubleEveryAction();

/* Reached with `await import` and never a static import beside the harness: the JSX compile step is
   registered as `renderTest` evaluates, and a static import resolves before that. */
const { AdminSchiedsrichterTable } = await import("@/features/schiedsrichter/components/collections/AdminSchiedsrichterTable.tsx");
const { AdminSpielerTable } = await import("@/features/spieler/components/collections/AdminSpielerTable.tsx");
const { AdminSpielorteTable } = await import("@/features/spielorte/components/collections/AdminSpielorteTable.tsx");
const { AdminTeamsTable } = await import("@/features/teams/components/collections/AdminTeamsTable.tsx");

const STILLGELEGT_AM = "2026-09-09";

const markup = (list: ReactNode): string => renderTree(underNext(list, { search: "saison_id=2026" }));

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
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
});

type List = { live: string; retired: string; html: string };

/** Each list with one live row and one retired row, keyed by the component's own module name. */
const LISTS: Record<string, List> = {
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

/** How many times one name is drawn with exactly this class list. */
const drawn = (html: string, classes: string, name: string): number => html.split(`<span class="${classes}">${name}</span>`).length - 1;

describe("a retired row on an admin list", () => {
  /* Both layouts draw the name, so each list draws it twice; a count of one is a layout spelling the
     name its own way, and the table and its phone card then disagree about the row. */
  it("draws its name in the shared retired ink in both layouts, and a live row's in the shared live ink", () => {
    assert.notEqual(identityName(true), identityName(false), "a retired row's name reads exactly like a live one's");
    assert.equal(identityName(false), IDENTITY_NAME_CLASSES);

    for (const [list, { live, retired, html }] of Object.entries(LISTS)) {
      assert.equal(drawn(html, identityName(true), retired), 2, `${list} draws the retired row's name in some other ink`);
      assert.equal(drawn(html, IDENTITY_NAME_CLASSES, live), 2, `${list} draws the live row's name in some other ink`);
    }
  });
});
