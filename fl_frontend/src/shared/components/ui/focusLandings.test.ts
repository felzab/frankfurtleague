import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderUnderWrite } from "@/shared/testing/postWrite.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";

doubleEveryAction();
doubleToasts();

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { AdminSpielorteView } = await import("@/features/spielorte/components/views/AdminSpielorteView.tsx");
const { AdminTeamsView } = await import("@/features/teams/components/views/AdminTeamsView.tsx");
const { AdminSchiedsrichterView } = await import("@/features/schiedsrichter/components/views/AdminSchiedsrichterView.tsx");
const { AdminSpielerView } = await import("@/features/spieler/components/views/AdminSpielerView.tsx");
const { AdminSpielortEditView } = await import("@/features/spielorte/components/views/AdminSpielortEditView.tsx");
const { AdminSchiedsrichterEditView } = await import("@/features/schiedsrichter/components/views/AdminSchiedsrichterEditView.tsx");
const { AdminSpielerEditView } = await import("@/features/spieler/components/views/AdminSpielerEditView.tsx");
const { AdminTeamEditView } = await import("@/features/teams/components/views/AdminTeamEditView.tsx");

/** One write whose control leaves the page, from the page before it to the page its refresh draws. */
type Landing = {
  before: () => ReactNode;
  /** The presses that send the write. */
  press: (user: UserEvent) => Promise<void>;
  after: () => ReactNode;
  /** Where the page keys its editor on the stored value, which draws every element anew. */
  remount?: boolean;
  /** The address the page stands on, for a list whose filter decides which rows the refresh keeps. */
  search?: string;
  /** Where the focus has to end. */
  lands: () => HTMLElement;
};

const RETIRED_ON = "2026-09-01";

/** The section a landing is judged in: both layouts of a list render, each its own section. */
const section = (key: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-focus-section="${key}"]`);
  assert.ok(found, `no section „${key}“ rendered`);
  return found;
};

const buttonIn = (key: string, name: string | RegExp): HTMLElement => within(section(key)).getByRole("button", { name });

const heading = (name: string | RegExp): HTMLElement => screen.getByRole("heading", { name });

/** The retirement a list's dialog confirms, from the row's own control. */
const retireThroughDialog = (key: string, row: string) => async (user: UserEvent) => {
  await user.click(buttonIn(key, `${row} stilllegen`));
  await pressTwice(user, { resting: "Stilllegen", armed: "Ja, stilllegen" });
};

const ADDRESS = { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" };

const ort = (id: string, name: string, inactive_since: string | null) => ({
  id,
  name,
  address: ADDRESS,
  maps_link: "https://maps.example.org",
  default_mietpreis: 40,
  inactive_since,
});
const ORT_A = "68c1f0a2b3c4d5e6f7a8b901";
const ORT_B = "68c1f0a2b3c4d5e6f7a8b902";

const team = (id: string, name: string, inactive_since: string | null) => ({
  id,
  name,
  full_name: `${name} e. V.`,
  shorthand: name.slice(0, 3).toUpperCase(),
  inactive_since,
  selected: { gruppe: "A" as const, austritt: null },
  isRetireable: true,
  publicSaisonId: null,
});
const TEAM_A = "68c1f0a2b3c4d5e6f7a8b911";
const TEAM_B = "68c1f0a2b3c4d5e6f7a8b912";

const schiedsrichter = (id: string, name: string, inactive_since: string | null) => ({
  id,
  name,
  schule: null,
  default_payment: 20,
  kontakt: { telefon: null, email: "pia@example.org" },
  inactive_since,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
});
const SR_A = "68c1f0a2b3c4d5e6f7a8b921";
const SR_B = "68c1f0a2b3c4d5e6f7a8b922";

const SQUAD = {
  team_id: TEAM_A,
  nummer: "10",
  position: null,
  stufe: null,
  ist_nachnominiert: false,
  rolle: null,
  teamName: "SG Alpha",
  teamShorthand: "SGA",
};
const spieler = (id: string, vorname: string, inactive_since: string | null, rowInactiveSince: string | null = null) => ({
  id,
  vorname,
  nachname: "Meier",
  fullName: `${vorname} Meier`,
  inactive_since,
  selected: { ...SQUAD, inactive_since: rowInactiveSince },
});
const SP_A = "68c1f0a2b3c4d5e6f7a8b931";
const SP_B = "68c1f0a2b3c4d5e6f7a8b932";
const SAISON_TEAMS = [{ teamId: TEAM_A, name: "SG Alpha", shorthand: "SGA" }];

const spielerList = (rows: ReturnType<typeof spieler>[]) =>
  h(AdminSpielerView, { spieler: rows, teams: SAISON_TEAMS, selectedSaisonId: "2026" });

/** The player's editor in the season its squad row stands in, retired as the case says. */
const spielerEditor = (inactiveSince: string | null) =>
  h(AdminSpielerEditView, {
    spieler: { id: SP_A, vorname: "Lena", nachname: "Meier", inactive_since: inactiveSince, geburtsdatum: null },
    einwilligung: null,
    saison: {
      saisonId: "2026",
      saisonStatus: "active" as const,
      erlaubteStufen: ["Q1" as const],
      nachnominierungLaeuft: null,
      membership: { ...SQUAD, inactive_since: null },
    },
    teams: SAISON_TEAMS,
    membershipCount: 1,
  });

const TEAM_RECORD = {
  id: TEAM_A,
  name: "SG Alpha",
  shorthand: "SGA",
  description: "",
  full_name: "Sportgemeinschaft Alpha",
  website_url: null,
  address: ADDRESS,
  schulform: null,
};

/** The club's editor in a planned season it is entered in. */
const teamEditor = (inactiveSince: string | null) =>
  h(AdminTeamEditView, {
    team: { ...TEAM_RECORD, inactive_since: inactiveSince },
    saison: {
      saisonId: "2026",
      saisonStatus: "future" as const,
      membership: { gruppe: "A" as const, austritt: null, trikot_farbe: null, kontakte: null, kontakte_stand: "stand" },
    },
    today: "2026-09-14",
    gruppeLocked: false,
    gruppeOffer: [
      { gruppe: "A" as const, occupied: 1, capacity: 4 },
      { gruppe: "B" as const, occupied: 0, capacity: 4 },
    ],
    swap: { teams: [], playedKnockoutSpiele: 0 },
    einladung: null,
  });

const SR_RECORD = { ...schiedsrichter(SR_A, "Pia Kraft", null) };

const LANDINGS: Record<string, Landing> = {
  "a venue row's reactivation, on the retirement replacing it": {
    before: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", RETIRED_ON), ort(ORT_B, "Halle B", null)] }),
    press: (user) => user.click(buttonIn("spielorte-karten", "Spielort Halle A reaktivieren")),
    after: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", null)] }),
    lands: () => buttonIn("spielorte-karten", "Spielort Halle A stilllegen"),
  },
  "a venue row's reactivation the filter then hides, on the next row's": {
    search: "status=stillgelegt",
    before: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", RETIRED_ON), ort(ORT_B, "Halle B", RETIRED_ON)] }),
    press: (user) => user.click(buttonIn("spielorte-tabelle", "Spielort Halle A reaktivieren")),
    after: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", RETIRED_ON)] }),
    lands: () => buttonIn("spielorte-tabelle", "Spielort Halle B reaktivieren"),
  },
  "a venue's retirement in the dialog, on the reactivation replacing its row's control": {
    before: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", null)] }),
    press: retireThroughDialog("spielorte-karten", "Spielort Halle A"),
    after: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", RETIRED_ON), ort(ORT_B, "Halle B", null)] }),
    lands: () => buttonIn("spielorte-karten", "Spielort Halle A reaktivieren"),
  },
  "a club row's reactivation, on the retirement replacing it": {
    before: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", RETIRED_ON), team(TEAM_B, "SG Beta", null)], numberOfGroups: 2 }),
    press: (user) => user.click(buttonIn("teams-karten", "Team SG Alpha reaktivieren")),
    after: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", null), team(TEAM_B, "SG Beta", null)], numberOfGroups: 2 }),
    lands: () => buttonIn("teams-karten", "Team SG Alpha stilllegen"),
  },
  "a club's retirement in the dialog, on the reactivation replacing its row's control": {
    before: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", null), team(TEAM_B, "SG Beta", null)], numberOfGroups: 2 }),
    press: retireThroughDialog("teams-tabelle", "Team SG Alpha"),
    after: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", RETIRED_ON), team(TEAM_B, "SG Beta", null)], numberOfGroups: 2 }),
    lands: () => buttonIn("teams-tabelle", "Team SG Alpha reaktivieren"),
  },
  "a referee row's reactivation, on the retirement replacing it": {
    before: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", RETIRED_ON), schiedsrichter(SR_B, "Ole Berg", null)] }),
    press: (user) => user.click(buttonIn("schiedsrichter-karten", /Pia Kraft reaktivieren$/)),
    after: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", null), schiedsrichter(SR_B, "Ole Berg", null)] }),
    lands: () => buttonIn("schiedsrichter-karten", /Pia Kraft stilllegen$/),
  },
  "a referee's retirement in the dialog, on the reactivation replacing its row's control": {
    before: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", null), schiedsrichter(SR_B, "Ole Berg", null)] }),
    press: async (user) => {
      await user.click(buttonIn("schiedsrichter-tabelle", /Pia Kraft stilllegen$/));
      await pressTwice(user, { resting: "Stilllegen", armed: "Ja, stilllegen" });
    },
    after: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", RETIRED_ON), schiedsrichter(SR_B, "Ole Berg", null)] }),
    lands: () => buttonIn("schiedsrichter-tabelle", /Pia Kraft reaktivieren$/),
  },
  "a player row's reactivation, on the retirement replacing it": {
    before: () => spielerList([spieler(SP_A, "Lena", RETIRED_ON), spieler(SP_B, "Mia", null)]),
    press: (user) => user.click(buttonIn("spieler-karten", "Spieler Lena Meier reaktivieren")),
    after: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", null)]),
    lands: () => buttonIn("spieler-karten", "Spieler Lena Meier stilllegen"),
  },
  "a player's retirement in the dialog, on the reactivation replacing its row's control": {
    before: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", null)]),
    press: retireThroughDialog("spieler-tabelle", "Spieler Lena Meier"),
    after: () => spielerList([spieler(SP_A, "Lena", RETIRED_ON), spieler(SP_B, "Mia", null)]),
    lands: () => buttonIn("spieler-tabelle", "Spieler Lena Meier reaktivieren"),
  },
  /* The list narrowed to retired squad rows drops the row its return revived, as working through them does. */
  "a squad row's return from the list, on the next row's": {
    search: "kader=ausgetragen&saison_id=2026",
    before: () => spielerList([spieler(SP_A, "Lena", null, RETIRED_ON), spieler(SP_B, "Mia", null, RETIRED_ON)]),
    press: (user) => user.click(buttonIn("spieler-karten", "Kadereintrag von Lena Meier reaktivieren")),
    after: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", null, RETIRED_ON)]),
    lands: () => buttonIn("spieler-karten", "Kadereintrag von Mia Meier reaktivieren"),
  },
  "a venue editor's reactivation, on the editor's heading": {
    before: () => h(AdminSpielortEditView, { spielort: ort(ORT_A, "Halle A", RETIRED_ON), inactiveSince: RETIRED_ON }),
    press: (user) => user.click(screen.getByRole("button", { name: "Reaktivieren" })),
    after: () => h(AdminSpielortEditView, { spielort: ort(ORT_A, "Halle A", null), inactiveSince: null }),
    remount: true,
    lands: () => heading("Halle A"),
  },
  "a referee editor's reactivation, on the editor's heading": {
    before: () => h(AdminSchiedsrichterEditView, { schiedsrichter: SR_RECORD, inactiveSince: RETIRED_ON }),
    press: (user) => user.click(screen.getByRole("button", { name: "Reaktivieren" })),
    after: () => h(AdminSchiedsrichterEditView, { schiedsrichter: SR_RECORD, inactiveSince: null }),
    remount: true,
    lands: () => heading("Pia Kraft"),
  },
  "a player editor's reactivation, on the editor's heading": {
    before: () => spielerEditor(RETIRED_ON),
    press: (user) => user.click(screen.getByRole("button", { name: "Reaktivieren" })),
    after: () => spielerEditor(null),
    remount: true,
    lands: () => heading("Lena Meier"),
  },
  "a club editor's reactivation, on the editor's heading": {
    before: () => teamEditor(RETIRED_ON),
    press: (user) => user.click(screen.getByRole("button", { name: "Reaktivieren" })),
    after: () => teamEditor(null),
    remount: true,
    lands: () => heading("SG Alpha"),
  },
};

/** What a failure names: the element the focus is on, by its tag and the words a reader hears. */
const described = (element: Element | null): string =>
  element === null || element === document.body
    ? "the page"
    : `<${element.tagName.toLowerCase()}> „${element.getAttribute("aria-label") ?? element.textContent?.trim() ?? ""}“`;

describe("where the focus lands once a write takes its control off the page", () => {
  for (const [name, landing] of Object.entries(LANDINGS)) {
    it(name, async () => {
      const user = userEvent.setup();
      const page = (tree: ReactNode) => underNext(tree, { search: landing.search ?? "saison_id=2026" });
      const view = renderUnderWrite(page(landing.before()));

      await landing.press(user);
      await view.answered();
      await view.refresh(page(landing.after()), { remount: landing.remount ?? false });

      const expected = landing.lands();
      // Never `assert.equal` over the two elements: its error keeps both, and the runner's report then
      // serialises every node and fibre behind them, many gigabytes before it prints.
      assert.ok(document.activeElement === expected, `the focus is on ${described(document.activeElement)}, not ${described(expected)}`);
    });
  }
});
