import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Fragment, createElement as h } from "react";

import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderUnderWrite } from "@/shared/testing/postWrite.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";

/* The browser's credential calls, which this runner lacks, answer as a ceremony that succeeded. */
const CEREMONY = () => Promise.resolve({ data: {}, error: null });
registerDoubles({ modules: { "core/authClient.ts": { authClient: { passkey: { addPasskey: CEREMONY }, signIn: { passkey: CEREMONY } } } } });

const { calls, answerWith } = doubleEveryAction();
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
const { SicherheitPanel } = await import("@/features/konto/components/views/SicherheitPanel.tsx");
const { AdminSperrlisteView } = await import("@/features/sperrliste/components/views/AdminSperrlisteView.tsx");
const { AdminBerechtigungenView } = await import("@/features/berechtigungen/components/views/AdminBerechtigungenView.tsx");
const { AppTopBar } = await import("@/shared/components/layout/shell/AppTopBar.tsx");
const { formatSpielDatum } = await import("@/shared/utils/format.ts");

/** One write whose control leaves the page, from the page before it to the page its refresh draws. */
type Landing = {
  /** What an action answers, by its name, where a plain success is not the answer the write needs. */
  answers?: Record<string, unknown>;
  before: () => ReactNode;
  /** The presses that send the write. */
  press: (user: UserEvent) => Promise<void>;
  after: () => ReactNode;
  /** Where the page keys its editor on the stored value, which draws every element anew. */
  remount?: boolean;
  /** The address the page stands on, for a list whose filter decides which rows the refresh keeps. */
  search?: string;
  /** The address the refresh carries, where the write itself is a change to it. */
  afterSearch?: string;
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
const ORT_C = "68c1f0a2b3c4d5e6f7a8b903";

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
const SP_C = "68c1f0a2b3c4d5e6f7a8b933";
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

const sperre = (id: string, erstellt_am: string) => ({
  id,
  grund: "Wiederholt Werbung gesendet.",
  erstellt_von: "verwaltung@example.org",
  erstellt_von_gesperrt: false,
  erstellt_am,
  gesperrt_bis_saison_id: "2026",
});
const SPERREN = [
  sperre("68c1f0a2b3c4d5e6f7a8b941", "2026-08-01"),
  sperre("68c1f0a2b3c4d5e6f7a8b942", "2026-08-02"),
  sperre("68c1f0a2b3c4d5e6f7a8b943", "2026-08-03"),
];
const aufheben = (erstellt_am: string) => `Sperre vom ${formatSpielDatum(erstellt_am)} aufheben`;

/** The page's own heading, as the shell's top bar draws it over every admin list. */
const TOP_BAR = h(AppTopBar, {
  title: "Sperrliste",
  isMobileOpen: false,
  onToggleMobileMenu: () => undefined,
  isDesktopCollapsed: false,
  kontoHref: null,
  isOnKonto: false,
});
const sperrliste = (rows: ReturnType<typeof sperre>[]) =>
  h(Fragment, null, TOP_BAR, h(AdminSperrlisteView, { sperrliste: rows, anzahlGesamt: rows.length }));

const zugang = (id: string, adresse: string) => ({
  id,
  adresse,
  gesperrt: false,
  verwaltung: "administration" as const,
  erteilt_von: "inhaber@example.org",
  erteilt_von_gesperrt: false,
  erteilt_am: "2026-09-01T08:00:00.000Z",
});
const zugaenge = (rows: ReturnType<typeof zugang>[]) =>
  h(AdminBerechtigungenView, { berechtigungen: rows, uebersprungen: 0, inhaberAdresse: "inhaber@example.org" });
const ZUGANG_A = zugang("68c1f0a2b3c4d5e6f7a8b951", "anna@example.org");
const ZUGANG_B = zugang("68c1f0a2b3c4d5e6f7a8b952", "ben@example.org");
const ZUGANG_C = zugang("68c1f0a2b3c4d5e6f7a8b953", "cem@example.org");

const HOUR_MS = 60 * 60 * 1000;

const passkey = (id: string, name: string) => ({
  id,
  name,
  anbieter: null,
  eingerichtetAm: "2026-09-01T08:00:00.000Z",
  zuletztVerwendetAm: null,
  diesesGeraet: false,
});
const anmeldung = (id: string, diesesGeraet: boolean, hour: string) => ({
  id,
  diesesGeraet,
  angemeldetAm: `2026-09-25T${hour}:00:00.000Z`,
  zuletztAktivAm: "2026-09-26T09:00:00.000Z",
  endetSpaetestensAm: "2026-10-25T08:00:00.000Z",
  faktor: { art: "code" as const },
});
const DIESE = anmeldung("diese", true, "07");
const FRUEH = anmeldung("frueh", false, "08");
const SPAET = anmeldung("spaet", false, "10");

/** What the security panel is handed, typed off the panel: this layer imports no slice's types. */
type Sicherheit = Parameters<typeof SicherheitPanel>[0]["sicherheit"];

/** A person's security panel, both windows open unless a case closes one. */
const sicherheit = (fields: Partial<Sicherheit> = {}): Sicherheit => ({
  passkeys: [passkey("laptop", "Laptop"), passkey("handy", "Handy")],
  kannHinzufuegen: true,
  anmeldungen: [DIESE, FRUEH, SPAET],
  verwaltung: false,
  inhaberId: "inhaber",
  inhaberAdresse: "spielerin@example.org",
  freshUntil: Date.now() + HOUR_MS,
  enrolmentUntil: Date.now() + HOUR_MS,
  servedAt: Date.now(),
  ...fields,
});
const panel = (stand: Sicherheit) => h(SicherheitPanel, { sicherheit: stand });

/** One panel for both renders, where the change is the panel's own state and no refresh redraws it. */
const STEP_UP_DUE = sicherheit({ passkeys: [passkey("laptop", "Laptop")], enrolmentUntil: null });

/** A sign-in's control, named by the minute it began, which is what tells two rows apart. */
const abmelden = (minute: string) => new RegExp(`vom 25\\. September 2026, ${minute} abmelden$`);

const LANDINGS: Record<string, Landing> = {
  "a venue row's reactivation, on the retirement replacing it": {
    before: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", RETIRED_ON)] }),
    press: (user) => user.click(buttonIn("spielorte-karten", "Spielort Halle B reaktivieren")),
    after: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", null)] }),
    lands: () => buttonIn("spielorte-karten", "Spielort Halle B stilllegen"),
  },
  "a venue row's reactivation the filter then hides, on the next row's": {
    search: "status=stillgelegt",
    before: () =>
      h(AdminSpielorteView, {
        spielorte: [ort(ORT_A, "Halle A", RETIRED_ON), ort(ORT_B, "Halle B", RETIRED_ON), ort(ORT_C, "Halle C", RETIRED_ON)],
      }),
    press: (user) => user.click(buttonIn("spielorte-tabelle", "Spielort Halle B reaktivieren")),
    after: () =>
      h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", RETIRED_ON), ort(ORT_B, "Halle B", null), ort(ORT_C, "Halle C", RETIRED_ON)] }),
    lands: () => buttonIn("spielorte-tabelle", "Spielort Halle C reaktivieren"),
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
    before: () =>
      spielerList([spieler(SP_A, "Lena", null, RETIRED_ON), spieler(SP_B, "Mia", null, RETIRED_ON), spieler(SP_C, "Nora", null, RETIRED_ON)]),
    press: (user) => user.click(buttonIn("spieler-karten", "Kadereintrag von Mia Meier reaktivieren")),
    after: () => spielerList([spieler(SP_A, "Lena", null, RETIRED_ON), spieler(SP_B, "Mia", null), spieler(SP_C, "Nora", null, RETIRED_ON)]),
    lands: () => buttonIn("spieler-karten", "Kadereintrag von Nora Meier reaktivieren"),
  },
  "a ban's removal, on the next ban's": {
    before: () => sperrliste(SPERREN),
    press: (user) => pressTwice(user, { resting: aufheben("2026-08-02"), armed: /^Ja, Sperre vom / }),
    after: () => sperrliste(SPERREN.filter((row) => row.erstellt_am !== "2026-08-02")),
    lands: () => screen.getByRole("button", { name: aufheben("2026-08-03") }),
  },
  /* The list has no heading of its own, and the empty list replaces it, so the page's heading takes the focus. */
  "the last ban's removal, on the page's heading": {
    before: () => sperrliste(SPERREN.slice(0, 1)),
    press: (user) => pressTwice(user, { resting: aufheben("2026-08-01"), armed: /^Ja, Sperre vom / }),
    after: () => sperrliste([]),
    lands: () => heading("Sperrliste"),
  },
  "a grant's revocation, on the next grant's": {
    before: () => zugaenge([ZUGANG_A, ZUGANG_B, ZUGANG_C]),
    press: (user) => pressTwice(user, { resting: "Zugang entziehen: ben@example.org", armed: "Ja, Zugang endgültig entziehen" }),
    after: () => zugaenge([ZUGANG_A, ZUGANG_C]),
    lands: () => screen.getByRole("button", { name: "Zugang entziehen: cem@example.org" }),
  },
  /* The pick fills the last dimension, so the closed add control replaces the panel's trigger in its place. */
  "a filter picked in the add panel's last dimension, on the closed add control": {
    search: "status=aktiv",
    before: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null)] }),
    press: async (user) => {
      await user.click(screen.getByRole("button", { name: "Filter hinzufügen" }));
      await user.click(within(screen.getByRole("dialog")).getByRole("option", { name: /^Bis 100 €/ }));
    },
    afterSearch: "status=aktiv&miete=bis_100",
    after: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null)] }),
    lands: () => screen.getByRole("button", { name: "Filter hinzufügen" }),
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
  "a passkey's deletion, on the next card's": {
    before: () => panel(sicherheit()),
    press: (user) => pressTwice(user, { resting: "Passkey „Laptop“ löschen", armed: "Ja, Passkey löschen" }),
    after: () => panel(sicherheit({ passkeys: [passkey("handy", "Handy")] })),
    lands: () => screen.getByRole("button", { name: "Passkey „Handy“ löschen" }),
  },
  "the last passkey's deletion, on the panel's heading once the list has gone": {
    before: () => panel(sicherheit({ passkeys: [passkey("laptop", "Laptop")] })),
    press: (user) => pressTwice(user, { resting: "Passkey „Laptop“ löschen", armed: "Ja, Passkey löschen" }),
    after: () => panel(sicherheit({ passkeys: [] })),
    lands: () => heading("Sicherheit"),
  },
  "a sign-in's sign-out, on the next sign-in's": {
    before: () => panel(sicherheit()),
    press: (user) => user.click(screen.getByRole("button", { name: abmelden("10:00") })),
    after: () => panel(sicherheit({ anmeldungen: [DIESE, SPAET] })),
    lands: () => screen.getByRole("button", { name: abmelden("12:00") }),
  },
  /* This device's row, the one before it, holds no sign-out, so the list's heading takes the focus. */
  "the last other sign-in's sign-out, on the list's heading": {
    before: () => panel(sicherheit({ anmeldungen: [DIESE, FRUEH] })),
    press: (user) => user.click(screen.getByRole("button", { name: abmelden("10:00") })),
    after: () => panel(sicherheit({ anmeldungen: [DIESE] })),
    lands: () => heading("Anmeldungen"),
  },
  "signing out every other sign-in, on the list's heading": {
    before: () => panel(sicherheit()),
    press: (user) => pressTwice(user, { resting: "Alle anderen abmelden", armed: "Ja, alle anderen abmelden" }),
    after: () => panel(sicherheit({ anmeldungen: [DIESE] })),
    lands: () => heading("Anmeldungen"),
  },
  "the confirmation before an enrolment, on the add control replacing it": {
    answers: { pruefeInhaberAction: { success: true, gleich: true } },
    before: () => panel(STEP_UP_DUE),
    press: (user) => user.click(screen.getByRole("button", { name: "Mit Passkey bestätigen" })),
    after: () => panel(STEP_UP_DUE),
    lands: () => screen.getByRole("button", { name: "Passkey hinzufügen" }),
  },
  "a first passkey's enrolment, on the add control under the list it starts": {
    before: () => panel(sicherheit({ passkeys: [] })),
    press: (user) => user.click(screen.getByRole("button", { name: "Passkey einrichten" })),
    after: () => panel(sicherheit({ passkeys: [passkey("laptop", "Laptop")] })),
    lands: () => screen.getByRole("button", { name: "Passkey hinzufügen" }),
  },
  "a passkey's saved name, on the rename control the form gives way to": {
    before: () => panel(sicherheit()),
    press: async (user) => {
      await user.click(screen.getByRole("button", { name: "Passkey „Laptop“ umbenennen" }));
      await user.type(screen.getByRole("textbox", { name: "Name" }), " alt");
      await user.click(screen.getByRole("button", { name: "Speichern" }));
    },
    after: () => panel(sicherheit({ passkeys: [passkey("laptop", "Laptop alt"), passkey("handy", "Handy")] })),
    lands: () => screen.getByRole("button", { name: "Passkey „Laptop alt“ umbenennen" }),
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
      answerWith(() => Promise.resolve(landing.answers?.[calls.at(-1)?.action ?? ""] ?? { success: true, message: "Gespeichert." }));
      const page = (tree: ReactNode, search = landing.search ?? "saison_id=2026") => underNext(tree, { search });
      const view = renderUnderWrite(page(landing.before()));

      await landing.press(user);
      await view.answered();
      await view.refresh(page(landing.after(), landing.afterSearch), { remount: landing.remount ?? false });

      const expected = landing.lands();
      // Never `assert.equal` over the two elements: its error keeps both, and the runner's report then
      // serialises every node and fibre behind them, many gigabytes before it prints.
      assert.ok(document.activeElement === expected, `the focus is on ${described(document.activeElement)}, not ${described(expected)}`);
    });
  }
});
