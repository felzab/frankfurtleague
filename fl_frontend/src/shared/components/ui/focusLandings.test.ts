import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { Fragment, createElement as h, useState } from "react";

import { act, screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { publishedLaufendeFassung } from "@/core/einwilligungDocument.ts";
import { registerDoubles } from "@/core/exportingModule.ts";
import { doubleEveryAction, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { laufendeNeubesetzung } from "@/shared/testing/einwilligungAnswers.ts";
import { kenntnisnahme } from "@/shared/testing/kenntnisnahme.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { renderUnderWrite } from "@/shared/testing/postWrite.ts";
import { saisonRules } from "@/shared/testing/saisonRules.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

import type { UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";

/* The browser's credential calls, which this runner lacks, answer as a ceremony that succeeded. */
const CEREMONY = () => Promise.resolve({ data: {}, error: null });
registerDoubles({ modules: { "core/authClient.ts": { authClient: { passkey: { addPasskey: CEREMONY }, signIn: { passkey: CEREMONY } } } } });

const { calls, answerWith, answered } = doubleEveryAction();
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
const { EinladungLinkHolder } = await import("@/features/einladungen/components/EinladungLinkHolder.tsx");
const { FormEinladungSection } = await import("@/features/teams/components/forms/AdminTeamEditForm/FormEinladungSection.tsx");
const { AdminBewerbungView } = await import("@/features/bewerbungen/components/views/AdminBewerbungView.tsx");
const { FormRolloverSection } = await import("@/features/saisons/components/forms/AdminSaisonEditForm/FormRolloverSection.tsx");
const { FormAustragenSection } = await import("@/features/spieler/components/forms/AdminSpielerEditForm/FormAustragenSection.tsx");
const { KaderZeileEditForm } = await import("@/features/spieler/components/forms/KaderZeileEditForm/KaderZeileEditForm.tsx");
const { KaderZeileAusgetragen } = await import("@/features/spieler/components/forms/KaderZeileEditForm/KaderZeileAusgetragen.tsx");
const { AdminKontakteEditView } = await import("@/features/kontakte/components/views/AdminKontakteEditView.tsx");
const { deriveKontakteDraftStatus } = await import("@/features/kontakte/kontakteDraftStatus.ts");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");
const { FormGruppenSwapSection } = await import("@/features/saisons/components/forms/AdminSaisonEditForm/FormGruppenSwapSection.tsx");
const { FormTeamErsatzSection } = await import("@/features/saisons/components/forms/AdminSaisonEditForm/FormTeamErsatzSection.tsx");
const { FormSpielplanSection } = await import("@/features/saisons/components/forms/AdminSaisonEditForm/FormSpielplanSection.tsx");
const { RegistrierungenView } = await import("@/features/registrierungen/components/views/RegistrierungenView.tsx");
const { EinwilligungPanel } = await import("@/features/konto/components/forms/EinwilligungForm/EinwilligungPanel.tsx");
const { EinwilligungForm } = await import("@/features/konto/components/forms/EinwilligungForm/EinwilligungForm.tsx");
const { patchBewerbungEinwilligungAction } = await import("@/features/kontakte/personActions.ts");
const { patchRegistrierungEinwilligungAction } = await import("@/features/registrierungen/personActions.ts");

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
  await user.click(buttonIn(key, `Stilllegen: ${row}`));
  await pressTwice(user, { resting: "Stilllegen", armed: "Ja, stilllegen" });
};

/**
 * A screen reader's activation of a table row's control: it moves the focus there, which react-aria's grid takes
 * onto a row of its own choosing, then clicks the control with no pointer, so the focus never stands on it.
 */
const pressVirtually = async (user: UserEvent, key: string, name: string | RegExp): Promise<void> => {
  const control = buttonIn(key, name);
  // react-aria shows the focus unless the last key or pointer event was a pointer's, which an earlier case's click
  // leaves behind in this process: a key press, as the reader's own, puts the page where a screen reader leaves it.
  await user.keyboard("{Escape}");
  act(() => control.focus());
  await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
  assert.ok(
    document.activeElement?.getAttribute("role") === "row",
    `the grid left the focus on ${described(document.activeElement)}, so this press is a pointer's`,
  );
  act(() => {
    control.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true, detail: 0 }));
  });
};

/** The retirement a table's dialog confirms, opened by a screen reader's activation of the row's own control. */
const retireVirtually = (key: string, row: string) => async (user: UserEvent) => {
  await pressVirtually(user, key, `Stilllegen: ${row}`);
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
  adresswechsel: null,
  abgelaufen: { bestaetigung: false, adresswechsel: false },
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
const spielerEditor = (inactiveSince: string | null, inKader = true) =>
  h(AdminSpielerEditView, {
    istFassungBekannt: true,
    spieler: { id: SP_A, vorname: "Lena", nachname: "Meier", inactive_since: inactiveSince, geburtsdatum: null },
    einwilligung: null,
    saison: {
      saisonId: "2026",
      saisonStatus: "active" as const,
      erlaubteStufen: ["Q1" as const],
      nachnominierungLaeuft: null,
      membership: inKader ? { ...SQUAD, inactive_since: null } : null,
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

/** A club in a season that has played nothing, as a swap reads it. */
const swapTeam = (id: string, name: string, gruppe: "A" | "B") => ({
  id,
  name,
  gruppe,
  gespielteGruppenSpiele: 0,
  gruppenSpieleProSpieltag: {},
  koSpieleProSpieltag: {},
});

/** The club's editor in a planned season, entered in the group the case names or in none, its group locked to a swap where it says. */
const teamEditor = (inactiveSince: string | null, { gruppe = "A" as "A" | "B" | null, locked = false } = {}) =>
  h(AdminTeamEditView, {
    team: { ...TEAM_RECORD, inactive_since: inactiveSince },
    saison: {
      saisonId: "2026",
      saisonStatus: "future" as const,
      membership:
        gruppe === null ? null : { gruppe, austritt: null, trikot_farbe: null, kontakte: null, bestaetigungen: null, kontakte_stand: "stand" },
    },
    today: "2026-09-14",
    gruppeLocked: locked,
    gruppeOffer: [
      { gruppe: "A" as const, occupied: 1, capacity: 4 },
      { gruppe: "B" as const, occupied: 0, capacity: 4 },
    ],
    swap: locked
      ? {
          teams: [swapTeam(TEAM_A, "SG Alpha", gruppe ?? "A"), swapTeam(TEAM_B, "SG Beta", gruppe === "B" ? "A" : "B")],
          playedKnockoutSpiele: 0,
        }
      : { teams: [], playedKnockoutSpiele: 0 },
    einladung: null,
  });

const SR_RECORD = { ...schiedsrichter(SR_A, "Pia Kraft", null) };

/** A pick in one of react-aria's pickers: its trigger, then the option. */
const pickOption = async (user: UserEvent, box: RegExp, option: RegExp) => {
  await user.click(screen.getByRole("button", { name: box }));
  await user.click(screen.getByRole("option", { name: option }));
};

const gruppenSwap = (alpha: "A" | "B") =>
  h(FormGruppenSwapSection, {
    saisonId: "2026",
    swap: { teams: [swapTeam(TEAM_A, "SG Alpha", alpha), swapTeam(TEAM_B, "TSV Beta", alpha === "A" ? "B" : "A")], playedKnockoutSpiele: 0 },
    isFinishedSaison: false,
  });

const teamErsatz = (ausscheidend: { id: string; name: string }) =>
  h(FormTeamErsatzSection, {
    saisonId: "2026",
    ersatz: {
      rows: [
        { teamId: ausscheidend.id, name: ausscheidend.name, gruppe: "A", spiele: 4, gespielteSpiele: 0, hasAustritt: false, isVerwaist: false },
      ],
      candidates: [{ id: "68c1f0a2b3c4d5e6f7a8b971", name: "TSV Gamma", isStillgelegt: false, isInSaison: false }],
    },
    isFinishedSaison: false,
  });

const SCHEDULE = [
  { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 4 },
  { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
  { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
];
const SPIELPLAN_UNDRAWN = {
  saisonId: "2026",
  saisonStatus: "future",
  rules: saisonRules(),
  startDate: "2026-08-01",
  endDate: "2027-06-30",
  spielplan: null,
  spieltageCount: 0,
  schedule: SCHEDULE,
  gruppenOccupancy: { A: 4, B: 4 },
  bestand: { spiele: 0, erfasst: 0, angesetzt: 0 },
  hasDrawnSpiele: false,
  onBeforeWrite: () => true,
};
const SPIELPLAN_DRAWN = {
  ...SPIELPLAN_UNDRAWN,
  spielplan: { generiert_am: "2026-07-01", spieltage: 5, spiele: 15 },
  spieltageCount: 5,
  bestand: { spiele: 15, erfasst: 0, angesetzt: 0 },
  hasDrawnSpiele: true,
};

/** The plan's panel under state of its own for the pick and the boxes, which the season's view holds on the page. */
function HeldSpielplan(props: object): ReactNode {
  const [redraw, setRedraw] = useState({ picked: null, shape: { number_of_groups: 2, teams_per_group: 4, qualifiers_per_group: 2 } });

  return h(FormSpielplanSection as (props: object) => ReactNode, { ...props, redraw, onRedrawChange: setRedraw } as object);
}

/** The slices' own shapes, typed off their components: this layer imports no slice's types. */
type Einladung = NonNullable<Parameters<typeof FormEinladungSection>[0]["einladung"]>;
type Bewerbung = Parameters<typeof AdminBewerbungView>[0]["bewerbung"];
type Person = NonNullable<Bewerbung["kontakte"]["trainer"]>;
type Kontakte = NonNullable<NonNullable<Parameters<typeof AdminKontakteEditView>[0]["saison"]["membership"]>["kontakte"]>;

/** The one stop a closed control leaves: its overlay, the control itself being inert beneath it. */
const openStop = (name: string): HTMLElement => {
  const stop = screen.getAllByRole("button", { name }).find((each) => each.closest("[inert]") === null);
  assert.ok(stop, `no stop named „${name}“ stands outside an inert box`);
  return stop;
};

/** The club's registration link panel in a planned season, under the holder the page keeps the new link in. */
const einladungPanel = (einladung: Einladung | null) =>
  h(EinladungLinkHolder, {
    scope: `${TEAM_A}:2026`,
    children: h(FormEinladungSection, { teamId: TEAM_A, saisonId: "2026", isMember: true, isFinishedSaison: false, einladung, laeuft: true }),
  });
const EINLADUNG: Einladung = {
  id: "68c1f0a2b3c4d5e6f7a8b961",
  saison_id: "2026",
  team_id: TEAM_A,
  erstellt_am: "2026-09-01",
  erstellt_von: "verwaltung@example.org",
  erstellt_von_gesperrt: false,
  widerrufen_am: null,
  versand: null,
};
const MINTED = {
  success: true,
  einladung_id: EINLADUNG.id,
  token: "token",
  link: "https://example.org/registrierung/token",
  message: "Angelegt.",
};

const kontaktperson = (vorname: string, email: string | null, bestaetigtAm: string | null): Person => ({
  vorname,
  nachname: "Meier",
  email: email ?? `${vorname.toLowerCase()}@schule.example`,
  telefon: "069 1234567",
  geburtsdatum: bestaetigtAm === null ? null : "1988-04-02",
  einwilligung: kenntnisnahme({
    erfasst_von: bestaetigtAm === null ? "administrativ" : "person",
    text_version: "2026-09-bestaetigungsseite",
    datum: "2026-09-01",
    bestaetigt_am: bestaetigtAm,
  }),
});
const SITZ = { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: null, zustellung: null };
const OFFENE_BESTAETIGUNGEN = { ansprechperson: SITZ, stellvertretung: SITZ, trainer: { ...SITZ, abgelehnt_am: "2026-09-03" } };

/** An open application for a club, its three seats confirmed, so nothing closes either decision. */
const OFFEN: Bewerbung = {
  id: "68d0f2a4c1e2b3a4d5e6f708",
  saison_id: "2027",
  eingereicht_am: "2026-09-01",
  status: "eingereicht",
  team_id: "68d0f2a4c1e2b3a4d5e6f709",
  schule: null,
  kontakte: {
    ansprechperson: kontaktperson("Anna", null, "2026-09-02"),
    stellvertretung: kontaktperson("Bernd", null, "2026-09-02"),
    trainer: kontaktperson("Clara", null, "2026-09-03"),
    trainer_ist_zugleich: null,
  },
  trikot: { vorhandener_satz: "Ein Satz", wunschfarbe: null },
  kader: { voraussichtliche_groesse: 14, gute_spieler: 2 },
  stufengroesse: 96,
  wunschgegner: null,
  entscheidung: null,
  bestaetigungen: { ansprechperson: SITZ, stellvertretung: SITZ, trainer: SITZ },
  bestaetigungsfrist: "2099-12-31",
};
const ENTSCHIEDEN = { getroffen_am: "2026-09-10", von: "Admin", von_gesperrt: false, grund: null };

/** The Stellvertretung still waits on her link and the Trainer declined, so the strip offers its three controls. */
const MIT_OFFENEN_SITZEN: Bewerbung = {
  ...OFFEN,
  kontakte: { ...OFFEN.kontakte, stellvertretung: kontaktperson("Bernd", null, null), trainer: kontaktperson("Clara", null, null) },
  bestaetigungen: OFFENE_BESTAETIGUNGEN,
};
const bewerbungPage = (bewerbung: Bewerbung) =>
  h(AdminBewerbungView, {
    neubesetzung: laufendeNeubesetzung(),
    bewerbung,
    fristAbgelaufen: false,
    teamName: "SG Alpha",
    saisonStatus: "future",
    gruppeOffer: [{ gruppe: "A", occupied: 1, capacity: 4 }],
  });

const rollover = (saisonStatus: "future" | "active") =>
  h(FormRolloverSection, {
    saisonId: "2026",
    saisonStatus,
    rollover: { outgoingSaisonId: null, offeneSpiele: [], hasUndatierteSpieltage: false },
    hasDrawnSpiele: true,
    onBeforeActivate: () => true,
    banners: [],
  });

const austragen = (rowInactiveSince: string | null) =>
  h(FormAustragenSection, { spielerId: SP_A, saisonId: "2026", rowInactiveSince, rowReturn: "open", banners: [], isDirty: false });

/** One squad row as its seat holder's page draws it: the editor while live, read-only once ausgetragen. */
const KADER_ZEILE = {
  spieler_id: SP_A,
  vorname: "Lena",
  nachname: "Meier",
  nummer: "10",
  position: null,
  stufe: null,
  rolle: null,
  ist_nachnominiert: false,
  inactive_since: null,
  nummer_doppelt: false,
};
const KADER_HREF = `/bereich/team/${TEAM_A}/2026/kader`;
const kaderZeileEditor = () =>
  h(KaderZeileEditForm, {
    teamId: TEAM_A,
    saisonId: "2026",
    zeile: KADER_ZEILE,
    erlaubteStufen: ["Q1"],
    heldRollen: {},
    kaderHref: KADER_HREF,
  });
const kaderZeileAusgetragen = () => h(KaderZeileAusgetragen, { zeile: { ...KADER_ZEILE, inactive_since: RETIRED_ON }, kaderHref: KADER_HREF });

const GRACE = kontaktperson("Grace", "grace@example.org", "2026-03-14");
/** The club's contacts editor, its draft status as the page derives it, one seat holding a person with an address. */
const kontakteEditor = (kontakte: Kontakte | null) =>
  h(DraftStatusProvider, {
    status: deriveKontakteDraftStatus({ stored: { kontakte }, draft: { kontakte }, fieldErrors: {} }),
    children: h(AdminKontakteEditView, {
      laufendesLabel: publishedLaufendeFassung("bewerbung").text_version,
      team: { id: TEAM_A, name: "SG Alpha", shorthand: "ALP", inactive_since: null },
      saison: {
        saisonId: "2026",
        saisonStatus: "active",
        membership: { gruppe: "A", austritt: null, trikot_farbe: null, kontakte, bestaetigungen: null, kontakte_stand: "9f2c" },
      },
    }),
  });
const MIT_GRACE: Kontakte = { trainer: null, ansprechperson: GRACE, stellvertretung: null, trainer_ist_zugleich: null };
const ERASURE_READ = {
  success: true,
  ansicht: { acknowledged: 1, saison_teams: [{ saison_id: "2025", rolle: "trainer", vorname: "Grace", nachname: "Meier" }], bewerbungen: [] },
};

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
const topBar = (title: string) =>
  h(AppTopBar, {
    title,
    isMobileOpen: false,
    onToggleMobileMenu: () => undefined,
    isDesktopCollapsed: false,
    kontoHref: null,
    isOnKonto: false,
  });
const sperrliste = (rows: ReturnType<typeof sperre>[]) =>
  h(Fragment, null, topBar("Sperrliste"), h(AdminSperrlisteView, { sperrliste: rows, anzahlGesamt: rows.length }));

const zugang = (id: string, adresse: string, verwaltung: "owner" | "administration" = "administration") => ({
  id,
  adresse,
  gesperrt: false,
  verwaltung,
  erteilt_von: "inhaber@example.org",
  erteilt_von_gesperrt: false,
  erteilt_am: "2026-09-01T08:00:00.000Z",
});
const zugaenge = (rows: ReturnType<typeof zugang>[]) =>
  h(AdminBerechtigungenView, { berechtigungen: rows, uebersprungen: 0, inhaberAdresse: "inhaber@example.org" });
const ZUGANG_A = zugang("68c1f0a2b3c4d5e6f7a8b951", "anna@example.org");
const ZUGANG_B = zugang("68c1f0a2b3c4d5e6f7a8b952", "ben@example.org");
const ZUGANG_C = zugang("68c1f0a2b3c4d5e6f7a8b953", "cem@example.org");
const INHABER = "inhaber@example.org";
/** The list as its owner sees it, the signed-in owner's own grant first: stepping down ends the ownership every tier control needs. */
const eigeneZugaenge = (verwaltung: "owner" | "administration") =>
  h(
    Fragment,
    null,
    topBar("Berechtigungen"),
    h(AdminBerechtigungenView, {
      berechtigungen: [zugang("68c1f0a2b3c4d5e6f7a8b954", INHABER, verwaltung), ZUGANG_A, ZUGANG_B],
      uebersprungen: 0,
      inhaberAdresse: verwaltung === "owner" ? INHABER : null,
    }),
  );

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
const abmelden = (minute: string) => new RegExp(`^Abmelden: .* vom 25\\. September 2026, ${minute}$`);

/** One confirmed pending registration on team A, as the seat holder's read serves it. */
const registrierung = (registrierung_id: string, vorname: string, nachname: string) => ({
  registrierung_id,
  eingereicht_am: "2026-09-20",
  vorname,
  nachname,
  nummer: null,
  position: null,
  stufe: null,
  aufnehmbar: true,
  nummer_doppelt: false,
  person: null,
  vorschlag: null,
});
const REG_LENA = registrierung("68c1f0a2b3c4d5e6f7a8b941", "Lena", "Meier");
const REG_MIA = registrierung("68c1f0a2b3c4d5e6f7a8b942", "Mia", "Schmidt");

/** Team A's registrations page holding `rows`, whatever the refresh after a decision left. */
const registrierungen = (rows: readonly ReturnType<typeof registrierung>[]) =>
  h(RegistrierungenView, { registrierungen: rows, adresse: { team_id: TEAM_A, saison_id: "2026" }, unvollstaendig: null });

const BEWERBUNG_ID = "68c1f0a2b3c4d5e6f7a8b951";
const KONTO_TITEL = "Als Ansprechperson: Bewerbung für Goethe-Gymnasium, Saison 2026";

/**
 * A pending application's seat on the account page, as the read serves it: withdraw-only, so a
 * withdrawal closes the switch it was pressed on once the page is read again.
 */
const kontoBewerbung = (medien: boolean, whatsapp = false) =>
  h(EinwilligungPanel, {
    eintraege: [
      {
        id: `bewerbung-${BEWERBUNG_ID}`,
        titel: KONTO_TITEL,
        bestaetigt: null,
        // Instantiated at the seat's scope: `h` infers no component's type parameter.
        control: h(EinwilligungForm<Parameters<typeof patchBewerbungEinwilligungAction>[1]["umfang"]>, {
          worte: {
            textVersion: "konto-test-1",
            whatsapp: {
              schalter: "Die Liga darf mich auch über WhatsApp erreichen.",
              an: "kontaktdaten_whatsapp",
              aus: "kontaktdaten",
              absatz: "WhatsApp nur mit Deiner Erlaubnis.",
            },
            medien: {
              schalter: "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen.",
              absatz: "Fotos nur mit Deiner Erlaubnis.",
            },
            nurWiderruf: "Hier kannst Du nur zurücknehmen.",
            widerruf: "Jede Änderung gilt ab dem Speichern.",
          },
          gespeichert: { umfang: whatsapp ? ("kontaktdaten_whatsapp" as const) : ("kontaktdaten" as const), medien: medien },
          nachweisStand: { umfang: null, medien: null },
          medienAngeboten: false,
          erteilbar: false,
          // Through the doubled export, bound as the page binds it.
          speichereAction: patchBewerbungEinwilligungAction.bind(null, BEWERBUNG_ID),
        }),
      },
    ],
  });

const REGISTRIERUNG_ID = "68c1f0a2b3c4d5e6f7a8b952";
const REGISTRIERUNG_TITEL = "Registrierung: SG Alpha, Saison 2026";

/** A pending registration on the account page: withdraw-only, its scope chips beside its media switch. */
const kontoRegistrierung = (medien: boolean) =>
  h(EinwilligungPanel, {
    eintraege: [
      {
        id: `registrierung-${REGISTRIERUNG_ID}`,
        titel: REGISTRIERUNG_TITEL,
        bestaetigt: null,
        // For `kontoBewerbung`'s reason, at the registration's scope.
        control: h(EinwilligungForm<Parameters<typeof patchRegistrierungEinwilligungAction>[1]["umfang"]>, {
          worte: {
            textVersion: "konto-test-1",
            umfang: {
              frage: "Was darf von Deinem Namen auf der Website stehen?",
              optionen: { kader_oeffentlich: "Vorname und Initiale", intern: "Nur Nummer und Position" },
              absatz: "Was auf der Website steht.",
            },
            medien: {
              schalter: "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen.",
              absatz: "Fotos nur mit Deiner Erlaubnis.",
            },
            nurWiderruf: "Hier kannst Du nur zurücknehmen.",
            widerruf: "Jede Änderung gilt ab dem Speichern.",
          },
          gespeichert: { umfang: "intern" as const, medien: medien },
          nachweisStand: { umfang: null, medien: null },
          medienAngeboten: false,
          erteilbar: false,
          speichereAction: patchRegistrierungEinwilligungAction.bind(null, REGISTRIERUNG_ID),
        }),
      },
    ],
  });

const LANDINGS: Record<string, Landing> = {
  "a venue row's reactivation, on the retirement replacing it": {
    before: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", RETIRED_ON)] }),
    press: (user) => user.click(buttonIn("spielorte-karten", "Reaktivieren: Spielort Halle B")),
    after: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", null)] }),
    lands: () => buttonIn("spielorte-karten", "Stilllegen: Spielort Halle B"),
  },
  "a venue row's reactivation the filter then hides, on the next row's": {
    search: "status=stillgelegt",
    before: () =>
      h(AdminSpielorteView, {
        spielorte: [ort(ORT_A, "Halle A", RETIRED_ON), ort(ORT_B, "Halle B", RETIRED_ON), ort(ORT_C, "Halle C", RETIRED_ON)],
      }),
    press: (user) => user.click(buttonIn("spielorte-tabelle", "Reaktivieren: Spielort Halle B")),
    after: () =>
      h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", RETIRED_ON), ort(ORT_B, "Halle B", null), ort(ORT_C, "Halle C", RETIRED_ON)] }),
    lands: () => buttonIn("spielorte-tabelle", "Reaktivieren: Spielort Halle C"),
  },
  "a venue row's reactivation the filter then hides from the table's first row, on the next row's": {
    search: "status=stillgelegt",
    before: () =>
      h(AdminSpielorteView, {
        spielorte: [ort(ORT_A, "Halle A", RETIRED_ON), ort(ORT_B, "Halle B", RETIRED_ON), ort(ORT_C, "Halle C", RETIRED_ON)],
      }),
    press: (user) => user.click(buttonIn("spielorte-tabelle", "Reaktivieren: Spielort Halle A")),
    after: () =>
      h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", RETIRED_ON), ort(ORT_C, "Halle C", RETIRED_ON)] }),
    lands: () => buttonIn("spielorte-tabelle", "Reaktivieren: Spielort Halle B"),
  },
  "a venue's retirement in the dialog, on the reactivation replacing its row's control": {
    before: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", null)] }),
    press: retireThroughDialog("spielorte-karten", "Spielort Halle A"),
    after: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", RETIRED_ON), ort(ORT_B, "Halle B", null)] }),
    lands: () => buttonIn("spielorte-karten", "Reaktivieren: Spielort Halle A"),
  },
  "a club row's reactivation, on the retirement replacing it": {
    before: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", null), team(TEAM_B, "SG Beta", RETIRED_ON)], numberOfGroups: 2 }),
    press: (user) => user.click(buttonIn("teams-karten", "Reaktivieren: Team SG Beta")),
    after: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", null), team(TEAM_B, "SG Beta", null)], numberOfGroups: 2 }),
    lands: () => buttonIn("teams-karten", "Stilllegen: Team SG Beta"),
  },
  "a club's retirement in the dialog, on the reactivation replacing its row's control": {
    before: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", null), team(TEAM_B, "SG Beta", null)], numberOfGroups: 2 }),
    press: retireThroughDialog("teams-tabelle", "Team SG Alpha"),
    after: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", RETIRED_ON), team(TEAM_B, "SG Beta", null)], numberOfGroups: 2 }),
    lands: () => buttonIn("teams-tabelle", "Reaktivieren: Team SG Alpha"),
  },
  "a referee row's reactivation, on the retirement replacing it": {
    before: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", null), schiedsrichter(SR_B, "Ole Berg", RETIRED_ON)] }),
    press: (user) => user.click(buttonIn("schiedsrichter-karten", /^Reaktivieren: .*Ole Berg$/)),
    after: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", null), schiedsrichter(SR_B, "Ole Berg", null)] }),
    lands: () => buttonIn("schiedsrichter-karten", /^Stilllegen: .*Ole Berg$/),
  },
  "a referee's retirement in the dialog, on the reactivation replacing its row's control": {
    before: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", null), schiedsrichter(SR_B, "Ole Berg", null)] }),
    press: async (user) => {
      await user.click(buttonIn("schiedsrichter-tabelle", /^Stilllegen: .*Pia Kraft$/));
      await pressTwice(user, { resting: "Stilllegen", armed: "Ja, stilllegen" });
    },
    after: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", RETIRED_ON), schiedsrichter(SR_B, "Ole Berg", null)] }),
    lands: () => buttonIn("schiedsrichter-tabelle", /^Reaktivieren: .*Pia Kraft$/),
  },
  "a player row's reactivation, on the retirement replacing it": {
    before: () => spielerList([spieler(SP_A, "Lena", RETIRED_ON), spieler(SP_B, "Mia", null)]),
    press: (user) => user.click(buttonIn("spieler-karten", "Spieler reaktivieren: Lena Meier")),
    after: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", null)]),
    lands: () => buttonIn("spieler-karten", "Stilllegen: Spieler Lena Meier"),
  },
  "a player's retirement in the dialog, on the reactivation replacing its row's control": {
    before: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", null)]),
    press: retireThroughDialog("spieler-tabelle", "Spieler Lena Meier"),
    after: () => spielerList([spieler(SP_A, "Lena", RETIRED_ON), spieler(SP_B, "Mia", null)]),
    lands: () => buttonIn("spieler-tabelle", "Spieler reaktivieren: Lena Meier"),
  },
  "a venue table row's reactivation a screen reader activates, on the retirement replacing it": {
    before: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", RETIRED_ON)] }),
    press: (user) => pressVirtually(user, "spielorte-tabelle", "Reaktivieren: Spielort Halle B"),
    after: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", null)] }),
    lands: () => buttonIn("spielorte-tabelle", "Stilllegen: Spielort Halle B"),
  },
  "a venue table row's retirement a screen reader activates, on the reactivation replacing it": {
    before: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", null)] }),
    press: retireVirtually("spielorte-tabelle", "Spielort Halle B"),
    after: () => h(AdminSpielorteView, { spielorte: [ort(ORT_A, "Halle A", null), ort(ORT_B, "Halle B", RETIRED_ON)] }),
    lands: () => buttonIn("spielorte-tabelle", "Reaktivieren: Spielort Halle B"),
  },
  "a club table row's reactivation a screen reader activates, on the retirement replacing it": {
    before: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", null), team(TEAM_B, "SG Beta", RETIRED_ON)], numberOfGroups: 2 }),
    press: (user) => pressVirtually(user, "teams-tabelle", "Reaktivieren: Team SG Beta"),
    after: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", null), team(TEAM_B, "SG Beta", null)], numberOfGroups: 2 }),
    lands: () => buttonIn("teams-tabelle", "Stilllegen: Team SG Beta"),
  },
  "a club table row's retirement a screen reader activates, on the reactivation replacing it": {
    before: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", null), team(TEAM_B, "SG Beta", null)], numberOfGroups: 2 }),
    press: retireVirtually("teams-tabelle", "Team SG Beta"),
    after: () => h(AdminTeamsView, { teams: [team(TEAM_A, "SG Alpha", null), team(TEAM_B, "SG Beta", RETIRED_ON)], numberOfGroups: 2 }),
    lands: () => buttonIn("teams-tabelle", "Reaktivieren: Team SG Beta"),
  },
  "a referee table row's reactivation a screen reader activates, on the retirement replacing it": {
    before: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", null), schiedsrichter(SR_B, "Ole Berg", RETIRED_ON)] }),
    press: (user) => pressVirtually(user, "schiedsrichter-tabelle", /^Reaktivieren: .*Ole Berg$/),
    after: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", null), schiedsrichter(SR_B, "Ole Berg", null)] }),
    lands: () => buttonIn("schiedsrichter-tabelle", /^Stilllegen: .*Ole Berg$/),
  },
  "a referee table row's retirement a screen reader activates, on the reactivation replacing it": {
    before: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", null), schiedsrichter(SR_B, "Ole Berg", null)] }),
    press: async (user) => {
      await pressVirtually(user, "schiedsrichter-tabelle", /^Stilllegen: .*Ole Berg$/);
      await pressTwice(user, { resting: "Stilllegen", armed: "Ja, stilllegen" });
    },
    after: () =>
      h(AdminSchiedsrichterView, { schiedsrichter: [schiedsrichter(SR_A, "Pia Kraft", null), schiedsrichter(SR_B, "Ole Berg", RETIRED_ON)] }),
    lands: () => buttonIn("schiedsrichter-tabelle", /^Reaktivieren: .*Ole Berg$/),
  },
  "a player table row's reactivation a screen reader activates, on the retirement replacing it": {
    before: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", RETIRED_ON)]),
    press: (user) => pressVirtually(user, "spieler-tabelle", "Spieler reaktivieren: Mia Meier"),
    after: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", null)]),
    lands: () => buttonIn("spieler-tabelle", "Stilllegen: Spieler Mia Meier"),
  },
  "a player table row's retirement a screen reader activates, on the reactivation replacing it": {
    before: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", null)]),
    press: retireVirtually("spieler-tabelle", "Spieler Mia Meier"),
    after: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", RETIRED_ON)]),
    lands: () => buttonIn("spieler-tabelle", "Spieler reaktivieren: Mia Meier"),
  },
  /* The list narrowed to retired squad rows drops the row its return revived, as working through them does. */
  "a squad row's return from the list, on the next row's": {
    search: "kader=ausgetragen&saison_id=2026",
    before: () =>
      spielerList([spieler(SP_A, "Lena", null, RETIRED_ON), spieler(SP_B, "Mia", null, RETIRED_ON), spieler(SP_C, "Nora", null, RETIRED_ON)]),
    press: (user) => user.click(buttonIn("spieler-karten", "Kadereintrag reaktivieren: Mia Meier")),
    after: () => spielerList([spieler(SP_A, "Lena", null, RETIRED_ON), spieler(SP_B, "Mia", null), spieler(SP_C, "Nora", null, RETIRED_ON)]),
    lands: () => buttonIn("spieler-karten", "Kadereintrag reaktivieren: Nora Meier"),
  },
  "a squad row's return from the table's first row, on the next row's": {
    search: "kader=ausgetragen&saison_id=2026",
    before: () =>
      spielerList([spieler(SP_A, "Lena", null, RETIRED_ON), spieler(SP_B, "Mia", null, RETIRED_ON), spieler(SP_C, "Nora", null, RETIRED_ON)]),
    press: (user) => user.click(buttonIn("spieler-tabelle", "Kadereintrag reaktivieren: Lena Meier")),
    after: () => spielerList([spieler(SP_A, "Lena", null), spieler(SP_B, "Mia", null, RETIRED_ON), spieler(SP_C, "Nora", null, RETIRED_ON)]),
    lands: () => buttonIn("spieler-tabelle", "Kadereintrag reaktivieren: Mia Meier"),
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
  /* The pressed control goes with the ownership it gave up, and no row keeps one, so the page's heading takes the focus. */
  "an owner's own step-down, on the page's heading": {
    before: () => eigeneZugaenge("owner"),
    press: (user) => pressTwice(user, { resting: "Mich zur Verwaltung herabstufen", armed: "Ja, mich zur Verwaltung herabstufen" }),
    after: () => eigeneZugaenge("administration"),
    lands: () => heading("Berechtigungen"),
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
    before: () => h(AdminSchiedsrichterEditView, { istFassungBekannt: true, schiedsrichter: SR_RECORD, inactiveSince: RETIRED_ON }),
    press: (user) => user.click(screen.getByRole("button", { name: "Reaktivieren" })),
    after: () => h(AdminSchiedsrichterEditView, { istFassungBekannt: true, schiedsrichter: SR_RECORD, inactiveSince: null }),
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
    press: (user) => pressTwice(user, { resting: "Löschen: Passkey „Laptop“", armed: "Ja, Passkey löschen" }),
    after: () => panel(sicherheit({ passkeys: [passkey("handy", "Handy")] })),
    lands: () => screen.getByRole("button", { name: "Löschen: Passkey „Handy“" }),
  },
  "the last passkey's deletion, on the panel's heading once the list has gone": {
    before: () => panel(sicherheit({ passkeys: [passkey("laptop", "Laptop")] })),
    press: (user) => pressTwice(user, { resting: "Löschen: Passkey „Laptop“", armed: "Ja, Passkey löschen" }),
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
      await user.click(screen.getByRole("button", { name: "Umbenennen: Passkey „Laptop“" }));
      await user.type(screen.getByRole("textbox", { name: "Name" }), " alt");
      await user.click(screen.getByRole("button", { name: "Speichern" }));
    },
    after: () => panel(sicherheit({ passkeys: [passkey("laptop", "Laptop alt"), passkey("handy", "Handy")] })),
    lands: () => screen.getByRole("button", { name: "Umbenennen: Passkey „Laptop alt“" }),
  },
  "a first registration link, on the new link's copy control": {
    answers: { postEinladungAction: MINTED },
    before: () => einladungPanel(null),
    press: (user) => user.click(screen.getByRole("button", { name: "Registrierungslink anlegen" })),
    after: () => einladungPanel(EINLADUNG),
    lands: () => screen.getByRole("button", { name: "Link kopieren" }),
  },
  "a withdrawn link, on the first mint's control replacing it": {
    before: () => einladungPanel(EINLADUNG),
    press: async (user) => {
      await user.click(screen.getByRole("radio", { name: "Zurückziehen" }));
      await pressTwice(user, { resting: "Link zurückziehen", armed: "Ja, Link zurückziehen" });
    },
    after: () => einladungPanel(null),
    lands: () => screen.getByRole("button", { name: "Registrierungslink anlegen" }),
  },
  "an application's acceptance, on the application's heading": {
    before: () => bewerbungPage(OFFEN),
    press: async (user) => {
      const gruppe = document.querySelector('select[name="gruppe"]');
      assert.ok(gruppe, "the acceptance offers no group");
      await user.selectOptions(gruppe, "A");
      await pressTwice(user, { resting: "Bewerbung annehmen", armed: "Ja, Team verbindlich aufnehmen" });
    },
    after: () => bewerbungPage({ ...OFFEN, status: "angenommen", entscheidung: ENTSCHIEDEN }),
    remount: true,
    lands: () => heading("SG Alpha"),
  },
  "an application's decline, on the application's heading": {
    before: () => bewerbungPage(OFFEN),
    press: async (user) => {
      await user.type(screen.getByRole("textbox", { name: "Grund für die Absage" }), "Kein Platz.");
      await pressTwice(user, { resting: "Bewerbung ablehnen", armed: "Ja, Absage verbindlich verschicken" });
    },
    after: () => bewerbungPage({ ...OFFEN, status: "abgelehnt", entscheidung: { ...ENTSCHIEDEN, grund: "Kein Platz." } }),
    remount: true,
    lands: () => heading("SG Alpha"),
  },
  "a seat's re-sent link, on the seat's re-send drawn anew": {
    before: () => bewerbungPage(MIT_OFFENEN_SITZEN),
    press: (user) => user.click(screen.getByRole("button", { name: "Link erneut senden: Stellvertretung" })),
    after: () =>
      bewerbungPage({
        ...MIT_OFFENEN_SITZEN,
        bestaetigungen: { ...OFFENE_BESTAETIGUNGEN, stellvertretung: { ...SITZ, erinnert_am: "2026-09-05" } },
      }),
    remount: true,
    lands: () => screen.getByRole("button", { name: "Link erneut senden: Stellvertretung" }),
  },
  "a seat's corrected address, on the pencil that opened the box": {
    answers: { kontaktEmailKorrigierenAction: { success: true, verschickt: true, message: "Korrigiert." } },
    before: () => bewerbungPage(MIT_OFFENEN_SITZEN),
    press: async (user) => {
      await user.click(screen.getByRole("button", { name: "Adresse korrigieren: Bernd Meier" }));
      await user.clear(screen.getByRole("textbox", { name: "Neue E-Mail-Adresse" }));
      await user.type(screen.getByRole("textbox", { name: "Neue E-Mail-Adresse" }), "bernd.meier@schule.example");
      await user.click(screen.getByRole("button", { name: "Korrigieren und Link senden" }));
    },
    after: () =>
      bewerbungPage({
        ...MIT_OFFENEN_SITZEN,
        kontakte: { ...MIT_OFFENEN_SITZEN.kontakte, stellvertretung: kontaktperson("Bernd", "bernd.meier@schule.example", null) },
      }),
    remount: true,
    lands: () => screen.getByRole("button", { name: "Adresse korrigieren: Bernd Meier" }),
  },
  "a correction's cancel, on the pencil that opened the box": {
    before: () => bewerbungPage(MIT_OFFENEN_SITZEN),
    press: async (user) => {
      await user.click(screen.getByRole("button", { name: "Adresse korrigieren: Bernd Meier" }));
      await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    },
    after: () => bewerbungPage(MIT_OFFENEN_SITZEN),
    lands: () => screen.getByRole("button", { name: "Adresse korrigieren: Bernd Meier" }),
  },
  "a reseating's cancel, on the control that opened the box": {
    before: () => bewerbungPage(MIT_OFFENEN_SITZEN),
    press: async (user) => {
      await user.click(screen.getByRole("button", { name: "Neu besetzen: Trainer" }));
      await user.click(screen.getByRole("button", { name: "Abbrechen" }));
    },
    after: () => bewerbungPage(MIT_OFFENEN_SITZEN),
    lands: () => screen.getByRole("button", { name: "Neu besetzen: Trainer" }),
  },
  /* No other seat can be reseated, so the strip's heading takes the focus once the declined seat is filled. */
  "a reseated seat, on the strip's heading": {
    answers: { besetzeKontaktSitzAction: { success: true, verschickt: true, message: "Besetzt." } },
    before: () => bewerbungPage(MIT_OFFENEN_SITZEN),
    press: async (user) => {
      await user.click(screen.getByRole("button", { name: "Neu besetzen: Trainer" }));
      await user.type(screen.getByRole("textbox", { name: "Vorname" }), "Doreen");
      await user.type(screen.getByRole("textbox", { name: "Nachname" }), "Ostwald");
      await user.type(screen.getByRole("textbox", { name: "E-Mail" }), "doreen@schule.example");
      await user.type(screen.getByRole("textbox", { name: "Telefon" }), "069 7654321");
      await user.click(screen.getByRole("button", { name: "Neu besetzen und Link senden" }));
    },
    after: () =>
      bewerbungPage({
        ...MIT_OFFENEN_SITZEN,
        kontakte: {
          ...MIT_OFFENEN_SITZEN.kontakte,
          trainer: { ...kontaktperson("Doreen", "doreen@schule.example", null), nachname: "Ostwald" },
        },
        bestaetigungen: { ...OFFENE_BESTAETIGUNGEN, trainer: SITZ },
      }),
    remount: true,
    lands: () => heading("Bestätigungen"),
  },
  "a season's rollover, on the panel's heading": {
    before: () => rollover("future"),
    press: (user) => pressTwice(user, { resting: "Auf Saison 2026 umstellen", armed: "Ja, auf 2026 umstellen" }),
    after: () => rollover("active"),
    remount: true,
    lands: () => heading("Umstellung"),
  },
  "a squad row's removal, on the return replacing it": {
    before: () => austragen(null),
    press: (user) => user.click(screen.getByRole("button", { name: "Aus Kader 2026 austragen" })),
    after: () => austragen(RETIRED_ON),
    remount: true,
    lands: () => screen.getByRole("button", { name: "Kadereintrag reaktivieren" }),
  },
  "a squad row's return, on the removal replacing it": {
    before: () => austragen(RETIRED_ON),
    press: (user) => user.click(screen.getByRole("button", { name: "Kadereintrag reaktivieren" })),
    after: () => austragen(null),
    remount: true,
    lands: () => screen.getByRole("button", { name: "Aus Kader 2026 austragen" }),
  },
  /* The seat holder's austragen has no return to draw in its stead: the row turns read-only, its panel the landing. */
  "a seat holder's austragen of a squad row, on the read-only row's heading": {
    before: kaderZeileEditor,
    press: (user) => user.click(screen.getByRole("button", { name: "Aus Kader 2026 austragen" })),
    after: kaderZeileAusgetragen,
    remount: true,
    lands: () => heading("Kadereintrag"),
  },
  /* The editor is drawn anew with nobody stored, the control standing again closed: its overlay is the stop. */
  "a season's cleared contacts, on the closed control drawn anew": {
    before: () => kontakteEditor(MIT_GRACE),
    press: (user) => pressTwice(user, { resting: "Kontakte löschen", armed: "Ja, Kontakte dieser Saison endgültig löschen" }),
    after: () => kontakteEditor(null),
    remount: true,
    lands: () => openStop("Kontakte löschen"),
  },
  "a person's erasure, on the emptied seat's heading": {
    answers: { readKontaktErasureAnsichtAction: ERASURE_READ, eraseKontaktpersonAction: { success: true, cleared: 1, message: "Gelöscht." } },
    before: () => kontakteEditor(MIT_GRACE),
    press: (user) => pressTwice(user, { resting: "Kontaktperson löschen", armed: "Ja, Kontaktperson endgültig löschen" }),
    after: () => kontakteEditor({ ...MIT_GRACE, ansprechperson: null }),
    remount: true,
    lands: () => heading("Ansprechperson"),
  },
  /* Each of these is drawn anew closed, waiting on the picks it was pressed with: its overlay is the stop. */
  "a season's group swap, on its control drawn anew": {
    before: () => gruppenSwap("A"),
    press: async (user) => {
      await pickOption(user, /^Team/, /^SG Alpha/);
      await pickOption(user, /^Tauscht Gruppen mit/, /^TSV Beta/);
      await pressTwice(user, { resting: "Gruppen tauschen", armed: "Ja, Gruppen tauschen" });
    },
    after: () => gruppenSwap("B"),
    remount: true,
    lands: () => openStop("Gruppen tauschen"),
  },
  "a club replaced in the season, on its control drawn anew": {
    before: () => teamErsatz({ id: TEAM_A, name: "SG Alpha" }),
    press: async (user) => {
      await pickOption(user, /^Ausscheidendes Team/, /^SG Alpha/);
      await pickOption(user, /^Nachrückendes Team/, /^TSV Gamma/);
      await pressTwice(user, { resting: "Team ersetzen", armed: "Ja, Team ersetzen" });
    },
    after: () => teamErsatz({ id: "68c1f0a2b3c4d5e6f7a8b971", name: "TSV Gamma" }),
    remount: true,
    lands: () => openStop("Team ersetzen"),
  },
  "a season's first draw, on the plan's control drawn anew": {
    before: () => h(HeldSpielplan, SPIELPLAN_UNDRAWN),
    press: (user) => pressTwice(user, { resting: "Spielplan anlegen", armed: /^Ja, / }),
    after: () => h(HeldSpielplan, SPIELPLAN_DRAWN),
    remount: true,
    lands: () => openStop("Spielplan neu anlegen"),
  },
  "a plan's withdrawal, on the plan's control drawn anew": {
    before: () => h(HeldSpielplan, SPIELPLAN_DRAWN),
    press: async (user) => {
      await user.click(screen.getByRole("radio", { name: "Zurücknehmen" }));
      await pressTwice(user, { resting: "Spielplan zurücknehmen", armed: "Ja, Spielplan zurücknehmen" });
    },
    after: () => h(HeldSpielplan, SPIELPLAN_UNDRAWN),
    remount: true,
    lands: () => openStop("Spielplan anlegen"),
  },
  "a club's group swap from its editor, on its control drawn anew": {
    before: () => teamEditor(null, { locked: true }),
    press: async (user) => {
      await pickOption(user, /Tauschen mit/, /^SG Beta/);
      await pressTwice(user, { resting: "Gruppen tauschen", armed: "Ja, Gruppen tauschen" });
    },
    after: () => teamEditor(null, { gruppe: "B", locked: true }),
    remount: true,
    lands: () => openStop("Gruppen tauschen"),
  },
  "a club's entry into the season, on the panel's heading": {
    before: () => teamEditor(null, { gruppe: null }),
    press: async (user) => {
      const gruppe = document.querySelector('select[name="gruppe"]');
      assert.ok(gruppe, "the entry offers no group");
      await user.selectOptions(gruppe, "A");
      await user.click(screen.getByRole("button", { name: "In Saison 2026 aufnehmen" }));
    },
    after: () => teamEditor(null),
    remount: true,
    lands: () => heading("Saison 2026"),
  },
  "a player's entry into the squad, on the panel's heading": {
    before: () => spielerEditor(null, false),
    press: async (user) => {
      const team = document.querySelector('select[name="team_id"]');
      assert.ok(team, "the entry offers no club");
      await user.selectOptions(team, TEAM_A);
      await user.click(screen.getByRole("button", { name: "In Kader 2026 aufnehmen" }));
    },
    after: () => spielerEditor(null),
    remount: true,
    lands: () => heading("Kader 2026"),
  },
  "a referee's confirmation link, on its control drawn anew to send another": {
    before: () => h(AdminSchiedsrichterEditView, { istFassungBekannt: true, schiedsrichter: SR_RECORD, inactiveSince: null }),
    press: (user) => user.click(screen.getByRole("button", { name: "Bestätigungslink senden" })),
    after: () =>
      h(AdminSchiedsrichterEditView, {
        istFassungBekannt: true,
        schiedsrichter: {
          ...SR_RECORD,
          bestaetigung: { verschickt_am: "2026-09-21", erinnert_am: null, frist: "2026-10-05", zustellung: null },
        },
        inactiveSince: null,
      }),
    remount: true,
    lands: () => screen.getByRole("button", { name: "Link erneut senden: Bestätigung" }),
  },
  /* The discard takes its own panel away, so the focus lands on the contact panel beside it, which stays. */
  "a referee's waiting address discarded, on the contact panel's heading": {
    before: () =>
      h(AdminSchiedsrichterEditView, {
        istFassungBekannt: true,
        schiedsrichter: {
          ...SR_RECORD,
          adresswechsel: { email: "pia@neu.example", verschickt_am: "2026-09-21", frist: "2026-10-05", zustellung: null },
        },
        inactiveSince: null,
      }),
    press: (user) => user.click(screen.getByRole("button", { name: "Änderung verwerfen" })),
    after: () => h(AdminSchiedsrichterEditView, { istFassungBekannt: true, schiedsrichter: SR_RECORD, inactiveSince: null }),
    remount: true,
    lands: () => heading(/^Kontakt/),
  },
  "a club editor's reactivation, on the editor's heading": {
    before: () => teamEditor(RETIRED_ON),
    press: (user) => user.click(screen.getByRole("button", { name: "Reaktivieren" })),
    after: () => teamEditor(null),
    remount: true,
    lands: () => heading("SG Alpha"),
  },
  "a registration's admission, on the next row's admission": {
    before: () => registrierungen([REG_LENA, REG_MIA]),
    press: (user) => pressTwice(user, { resting: "Aufnehmen: Lena Meier", armed: "Ja, aufnehmen" }),
    after: () => registrierungen([REG_MIA]),
    lands: () => screen.getByRole("button", { name: "Aufnehmen: Mia Schmidt" }),
  },
  "an application seat's media withdrawal on the account page, closing its switch, on the record's heading": {
    answers: {
      patchBewerbungEinwilligungAction: { success: true, message: "Gespeichert.", nachweis_stand: { umfang: null, medien: "x".repeat(64) } },
    },
    before: () => kontoBewerbung(true),
    press: (user) => user.click(screen.getByRole("switch", { name: "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen." })),
    after: () => kontoBewerbung(false),
    lands: () => heading(KONTO_TITEL),
  },
  "an application seat's WhatsApp withdrawal on the account page, closing its switch, on the record's heading": {
    answers: {
      patchBewerbungEinwilligungAction: { success: true, message: "Gespeichert.", nachweis_stand: { umfang: "x".repeat(64), medien: null } },
    },
    before: () => kontoBewerbung(false, true),
    press: (user) => user.click(screen.getByRole("switch", { name: "Die Liga darf mich auch über WhatsApp erreichen." })),
    after: () => kontoBewerbung(false, false),
    lands: () => heading(KONTO_TITEL),
  },
  "a pending registration's media withdrawal on the account page, closing its switch, on the record's heading": {
    answers: {
      patchRegistrierungEinwilligungAction: {
        success: true,
        message: "Gespeichert.",
        nachweis_stand: { umfang: null, medien: "x".repeat(64) },
      },
    },
    before: () => kontoRegistrierung(true),
    press: (user) => user.click(screen.getByRole("switch", { name: "Die Liga darf Fotos, Videos und Interviews von mir veröffentlichen." })),
    after: () => kontoRegistrierung(false),
    lands: () => heading(REGISTRIERUNG_TITEL),
  },
  "a registration's decline, the last row, on the queue's heading": {
    before: () => registrierungen([REG_LENA]),
    press: (user) => pressTwice(user, { resting: "Ablehnen: Registrierung von Lena Meier", armed: "Ja, ablehnen" }),
    after: () => registrierungen([]),
    lands: () => heading("Offene Registrierungen"),
  },
};

/** What a failure names: the element the focus is on, by its tag and the words a reader hears. */
const described = (element: Element | null): string =>
  element === null || element === document.body
    ? "the page"
    : `<${element.tagName.toLowerCase()}> „${element.getAttribute("aria-label") ?? element.textContent?.trim() ?? ""}“`;

describe("where the focus lands once a write takes its control off the page", () => {
  // A landing a case left watching would take the next case's focus as that case's page draws.
  afterEach(() => {
    document.dispatchEvent(new window.KeyboardEvent("keydown"));
  });

  for (const [name, landing] of Object.entries(LANDINGS)) {
    it(name, async () => {
      const user = userEvent.setup();
      answerWith(() => Promise.resolve(landing.answers?.[calls.at(-1)?.action ?? ""] ?? { success: true, message: "Gespeichert." }));
      const page = (tree: ReactNode, search = landing.search ?? "saison_id=2026") => underNext(tree, { search });
      const view = renderUnderWrite(page(landing.before()));

      await landing.press(user);
      // Every write the press set off answered first, a confirmation's own check among them.
      await act(answered);
      await view.answered();
      await view.refresh(page(landing.after(), landing.afterSearch), { remount: landing.remount ?? false });

      const expected = landing.lands();
      // Never `assert.equal` over the two elements: its error keeps both, and the runner's report then
      // serialises every node and fibre behind them, many gigabytes before it prints.
      assert.ok(document.activeElement === expected, `the focus is on ${described(document.activeElement)}, not ${described(expected)}`);
    });
  }
});
