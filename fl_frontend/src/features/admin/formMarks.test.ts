import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { parseDate } from "@internationalized/date";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import ts from "typescript";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { side, spielFields } from "@/shared/testing/fixtures.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { getGermanTodayStr } from "@/shared/utils/date.ts";

import type { ReactNode } from "react";

/* Nothing here is saved: every write is held unanswered, and every read of the page stands still. */
doubleActions({ modules: [/\/src\/features\/\w+\/actions\.ts$/], answer: () => new Promise(() => undefined) });
doubleToasts();
globalThis.fetch = (() => new Promise(() => undefined)) as unknown as typeof globalThis.fetch;

/* `next/error` is CommonJS whose exports Node's static reader cannot see, so the sign-in card's ESM import
   of `catchError` fails at link: `fl_frontend/src/shared/hooks/draftFieldWiring.test.ts`'s shim. */
const NEXT_ERROR_INTEROP = `import { createRequire } from "node:module";
export const { catchError } = createRequire(${JSON.stringify(import.meta.filename)})("next/error");`;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/error" && (context.parentURL ?? "").endsWith("/SignInForm.tsx"))
      return { url: `data:text/javascript,${encodeURIComponent(NEXT_ERROR_INTEROP)}`, shortCircuit: true };
    return nextResolve(specifier, context);
  },
});

const { router } = recordingRouter();

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

/** A control's name as a reader hears it; the field's own label alone for a date segment, whose value leads it. */
function labelOf(el: Element): string {
  const ids = el.getAttribute("aria-labelledby");
  const last = ids?.split(/\s+/).at(-1);
  const text = last === undefined ? "" : (document.getElementById(last)?.textContent ?? "").trim();

  return text !== "" ? text : (el.getAttribute("aria-label") ?? "");
}

/**
 * Every mark the page carries: a required control by its name, or by its label where it has none, and each label
 * under a required wrapper, drawn as an asterisk or suppressed by an editor's form.
 */
function marksOn(into: Set<string>): void {
  for (const el of Array.from(document.body.querySelectorAll("[name]"))) {
    const name = el.getAttribute("name") ?? "";
    if (name !== "" && (el.getAttribute("aria-required") === "true" || el.hasAttribute("required"))) into.add(`name ${name}`);
  }
  for (const el of Array.from(document.body.querySelectorAll('[aria-required="true"]:not([name])')))
    into.add(`aria ${el.getAttribute("role") ?? el.tagName}:${labelOf(el)}`);
  for (const wrap of Array.from(document.body.querySelectorAll('[data-required="true"]'))) {
    const label = Array.from(wrap.children).find((child) => child.classList.contains("label"));
    if (label === undefined) continue;
    // `globals.css` suppresses the asterisk inside a form without the opt-in, and draws it anywhere else.
    const owner = wrap.closest("form");
    const drawn = owner === null || owner.getAttribute("data-required-marks") === "on";
    into.add(`star ${(label.textContent ?? "").trim()} ${drawn ? "drawn" : "suppressed"}`);
  }
}

/** Every switch still off, pressed through its label, a few rounds deep: one can reveal another, and each reveals fields. */
async function openEverySwitch(into: Set<string>): Promise<void> {
  const user = userEvent.setup();
  const pressed = new Set<string>();
  for (let round = 0; round < 4; round++) {
    const off = Array.from(document.body.querySelectorAll<HTMLInputElement>('input[role="switch"]')).filter(
      (input) => !input.checked && !input.disabled && !pressed.has(input.name + labelOf(input)),
    );
    if (off.length === 0) return;
    for (const input of off) {
      pressed.add(input.name + labelOf(input));
      const label = input.closest("label");
      if (label === null || !document.body.contains(input)) continue;
      await user.click(label);
      await settle();
      marksOn(into);
    }
  }
}

const geborenVor = (jahre: number): string => parseDate(getGermanTodayStr()).subtract({ years: jahre }).toString();

/** A birth date typed into the page's first date field, which is what offers a confirmation's age-bound questions. */
async function typeFirstDate(jahre: number, into: Set<string>): Promise<void> {
  const user = userEvent.setup();
  const [jahr, monat, tag] = geborenVor(jahre).split("-");
  const [first] = screen.getAllByRole("spinbutton", { name: /Tag/ });
  if (first === undefined) return;
  await user.click(first);
  await user.keyboard(`${tag ?? ""}${monat ?? ""}${jahr ?? ""}`);
  await settle();
  marksOn(into);
}

/** Every radio, pressed in turn: each answer can reveal its own fields. */
async function pressEveryRadio(into: Set<string>): Promise<void> {
  const user = userEvent.setup();
  for (const radio of screen.queryAllByRole("radio")) {
    await user.click(radio);
    await settle();
    marksOn(into);
  }
}

/** The form rendered as its page renders it, then opened as far as a reader can open it. */
async function marksOf(tree: ReactNode, open: (into: Set<string>) => Promise<void> = openEverySwitch): Promise<string[]> {
  const into = new Set<string>();
  render(underNext(tree, { router, search: "saison_id=2026" }));
  marksOn(into);
  await open(into);

  return [...into].sort();
}

const ADDRESS = { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" };
const PERSON = (vorname: string, email: string) => ({
  vorname,
  nachname: "Meier",
  email,
  telefon: "069 111",
  geburtsdatum: "1990-12-10",
  einwilligung: {
    umfang: "kontaktdaten" as const,
    erfasst_von: "person" as const,
    text_version: "1",
    datum: "2026-03-12",
    bestaetigt_am: "2026-03-14",
  },
});
const TEAM_A = { teamId: "68c1f0a2b3c4d5e6f7a8b9c1", name: "SG Alpha", shorthand: "SA" };
const TEAM_B = { teamId: "68c1f0a2b3c4d5e6f7a8b9c2", name: "SG Beta", shorthand: "SB" };
const VENUE = {
  id: "68c1f0a2b3c4d5e6f7a8b9d0",
  name: "Sportpark Nord",
  address: ADDRESS,
  maps_link: "https://maps.example/nord",
  default_mietpreis: 40,
  inactive_since: null,
};
const REFEREE = {
  id: "68c1f0a2b3c4d5e6f7a8b9d1",
  name: "Pia Kraft",
  schule: null,
  default_payment: 25,
  kontakt: { email: "pia@example.org", telefon: null },
  inactive_since: null,
};
const OFFER = [
  { gruppe: "A" as const, occupied: 1, capacity: 4 },
  { gruppe: "B" as const, occupied: 0, capacity: 4 },
];
const SAISON_RULES = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 2,
  teams_per_group: 4,
  max_kadergroesse: 18,
  tiebreak_order: "tordifferenz",
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "Q1"],
};
const LEVEL_KNOCKOUT = spielFields({
  id: "6890a1b2c3d4e5f607182901",
  saison_id: "2026",
  saison_phase: "achtelfinale",
  team1: side(TEAM_A.teamId, { name: TEAM_A.name, shorthand: TEAM_A.shorthand, tore: 2 }),
  team2: side(TEAM_B.teamId, { name: TEAM_B.name, shorthand: TEAM_B.shorthand, tore: 2 }),
  ergebnis: "2:2",
  elfmeterschiessen: { team1: 5, team2: 4 },
  ort: { spielort_id: VENUE.id, name: VENUE.name, maps_link: VENUE.maps_link, mietpreis: 40 },
  schiedsrichter: { schiedsrichter_id: REFEREE.id, name: REFEREE.name, payment: 25 },
} as never);
const staende = async () => {
  const { bestaetigungsStand } = await import("@/features/bewerbungen/bestaetigungStand.ts");
  const kontakt = (vorname: string, email: string) => ({
    vorname,
    nachname: "Meier",
    email,
    telefon: "069 1234567",
    geburtsdatum: null,
    einwilligung: {
      umfang: "kontaktdaten" as const,
      erfasst_von: "administrativ" as const,
      text_version: "1",
      datum: "2026-09-01",
      bestaetigt_am: null,
    },
  });
  const offen = { verschickt_am: "2026-09-01", erinnert_am: null, abgelehnt_am: null, zustellung: null };

  return bestaetigungsStand({
    kontakte: {
      ansprechperson: kontakt("Anna", "anna@schule.example"),
      stellvertretung: kontakt("Bernd", "bernd@schule.example"),
      trainer: null,
      trainer_ist_zugleich: null,
    },
    bestaetigungen: { ansprechperson: offen, stellvertretung: offen, trainer: { ...offen, abgelehnt_am: "2026-09-03" } },
    status: "eingereicht",
  } as never);
};

type FormCase = {
  /** The module that renders the form, below `src/`. */
  module: string;
  /** The page's form rendered and opened, answering every mark it carries. */
  marks: () => Promise<string[]>;
  expected: readonly string[];
};

/**
 * Every form in the tree, in the states that reveal its fields. **Each list is the form's marks whole**, so a wrapper
 * that ignores its form's schema drops or adds a mark somewhere below.
 */
const FORMS: Record<string, FormCase> = {
  "the venue editor": {
    module: "features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx",
    marks: async () => {
      const { AdminSpielortEditForm } = await import("@/features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx");
      return marksOf(
        h(AdminSpielortEditForm, {
          spielort: { id: VENUE.id, name: VENUE.name, address: ADDRESS, default_mietpreis: 40 },
          isRetired: false,
          pageHeader: { title: VENUE.name },
        } as never),
      );
    },
    expected: ["aria INPUT:Standard-Mietpreis", "name address.plz", "name address.stadt", "name address.strasse", "name name"],
  },
  "the referee editor": {
    module: "features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx",
    marks: async () => {
      const { AdminSchiedsrichterEditForm } =
        await import("@/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx");
      return marksOf(
        h(AdminSchiedsrichterEditForm, {
          schiedsrichter: {
            id: REFEREE.id,
            name: REFEREE.name,
            schule: null,
            kontakt: { email: "pia@example.org", telefon: null },
            default_payment: 25,
            geburtsdatum: null,
            einwilligung: null,
            bestaetigung: null,
          },
          isRetired: false,
          pageHeader: { title: REFEREE.name },
        } as never),
      );
    },
    expected: ["aria INPUT:Standard-Honorar", "name kontakt.email", "name name"],
  },
  "the player editor, rostered and unrostered": {
    module: "features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx",
    marks: async () => {
      const { AdminSpielerEditForm } = await import("@/features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx");
      const spieler = { id: "68c1f0a2b3c4d5e6f7a8b9c0", vorname: "Lena", nachname: "Meier", inactive_since: null, geburtsdatum: null };
      const membership = {
        team_id: TEAM_A.teamId,
        nummer: "10",
        position: null,
        stufe: null,
        ist_nachnominiert: false,
        rolle: null,
        inactive_since: null,
      };
      const editor = (withMembership: boolean) =>
        h(AdminSpielerEditForm, {
          spieler,
          einwilligung: null,
          saison: {
            saisonId: "2026",
            saisonStatus: "active",
            erlaubteStufen: ["Q1"],
            nachnominierungLaeuft: null,
            membership: withMembership ? membership : null,
          },
          teams: [TEAM_A, TEAM_B],
          membershipCount: withMembership ? 1 : 0,
          pageHeader: { title: "Lena Meier" },
        } as never);
      const rostered = await marksOf(editor(true));
      document.body.innerHTML = "";
      const unrostered = await marksOf(editor(false));

      return [...rostered.map((mark) => `rostered ${mark}`), ...unrostered.map((mark) => `unrostered ${mark}`)];
    },
    expected: ["rostered name vorname", "unrostered name vorname", "unrostered star Team suppressed"],
  },
  "the club editor": {
    module: "features/teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx",
    marks: async () => {
      const { AdminTeamEditForm } = await import("@/features/teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx");
      return marksOf(
        h(AdminTeamEditForm, {
          team: {
            id: TEAM_A.teamId,
            name: TEAM_A.name,
            shorthand: TEAM_A.shorthand,
            description: "",
            full_name: "Sportgemeinschaft Alpha",
            website_url: null,
            address: ADDRESS,
            schulform: null,
            inactive_since: null,
          },
          saison: {
            saisonId: "2026",
            saisonStatus: "future",
            membership: { gruppe: "A", austritt: null, trikot_farbe: null, kontakte: null, kontakte_stand: "stand" },
          },
          today: "2026-09-14",
          gruppeLocked: false,
          gruppeOffer: OFFER,
          swap: { teams: [], playedKnockoutSpiele: 0 },
          einladung: null,
          pageHeader: { title: TEAM_A.name },
        } as never),
      );
    },
    expected: [
      "aria spinbutton:Wirksam ab",
      "name address.plz",
      "name address.stadt",
      "name address.strasse",
      "name austritt.grund",
      "name austritt.type",
      "name full_name",
      "name name",
      "name shorthand",
    ],
  },
  "the contacts editor, seated and empty": {
    module: "features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx",
    marks: async () => {
      const { AdminKontakteEditForm } = await import("@/features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx");
      const editor = (kontakte: unknown) =>
        h(AdminKontakteEditForm, {
          teamId: TEAM_A.teamId,
          saison: {
            saisonId: "2026",
            saisonStatus: "future",
            membership: { gruppe: "A", austritt: null, trikot_farbe: null, kontakte, kontakte_stand: "stand" },
          },
          pageHeader: { title: TEAM_A.name },
        } as never);
      const seated = await marksOf(
        editor({
          ansprechperson: PERSON("Grace", "grace@example.org"),
          stellvertretung: PERSON("Alan", "alan@example.org"),
          trainer: PERSON("Ada", "ada@example.org"),
          trainer_ist_zugleich: null,
        }),
      );
      document.body.innerHTML = "";
      const empty = await marksOf(editor(null));

      return [...seated.map((mark) => `seated ${mark}`), ...empty.map((mark) => `empty ${mark}`)];
    },
    expected: [
      "empty aria spinbutton:Erfasst am",
      "empty name kontakte.ansprechperson.einwilligung.text_version",
      "empty name kontakte.ansprechperson.email",
      "empty name kontakte.ansprechperson.nachname",
      "empty name kontakte.ansprechperson.telefon",
      "empty name kontakte.ansprechperson.vorname",
      "empty name kontakte.stellvertretung.einwilligung.text_version",
      "empty name kontakte.stellvertretung.email",
      "empty name kontakte.stellvertretung.nachname",
      "empty name kontakte.stellvertretung.telefon",
      "empty name kontakte.stellvertretung.vorname",
      "empty name kontakte.trainer.einwilligung.text_version",
      "empty name kontakte.trainer.email",
      "empty name kontakte.trainer.nachname",
      "empty name kontakte.trainer.telefon",
      "empty name kontakte.trainer.vorname",
      "seated aria spinbutton:Erfasst am",
      "seated name kontakte.ansprechperson.einwilligung.text_version",
      "seated name kontakte.ansprechperson.email",
      "seated name kontakte.ansprechperson.nachname",
      "seated name kontakte.ansprechperson.telefon",
      "seated name kontakte.ansprechperson.vorname",
      "seated name kontakte.stellvertretung.einwilligung.text_version",
      "seated name kontakte.stellvertretung.email",
      "seated name kontakte.stellvertretung.nachname",
      "seated name kontakte.stellvertretung.telefon",
      "seated name kontakte.stellvertretung.vorname",
      "seated name kontakte.trainer.einwilligung.text_version",
      "seated name kontakte.trainer.email",
      "seated name kontakte.trainer.nachname",
      "seated name kontakte.trainer.telefon",
      "seated name kontakte.trainer.vorname",
    ],
  },
  "the season editor": {
    module: "features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx",
    marks: async () => {
      const { AdminSaisonEditView } = await import("@/features/saisons/components/views/AdminSaisonEditView.tsx");
      return marksOf(
        h(AdminSaisonEditView, {
          saison: {
            id: "2026",
            status: "future",
            start_date: "2026-08-01",
            end_date: "2027-06-30",
            rules: SAISON_RULES,
            bewerbung: null,
            registrierung: null,
          },
          rollover: { outgoingSaisonId: null, offeneSpiele: [], hasUndatierteSpieltage: false },
          swap: { teams: [], playedKnockoutSpiele: 0 },
          ersatz: { rows: [], candidates: [] },
          spielplan: {
            spielplan: null,
            spieltageCount: 0,
            schedule: [
              { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 4 },
              { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
              { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
            ],
            bestand: { spiele: 0, erfasst: 0, angesetzt: 0 },
          },
          hasDrawnSpiele: false,
          spieltagBound: { startMax: null, endMin: null },
        } as never),
      );
    },
    expected: [
      "aria INPUT:Maximale Kadergröße",
      "aria INPUT:Punkte für ein Unentschieden",
      "aria INPUT:Punkte für einen Sieg",
      "aria INPUT:Teams pro Gruppe",
      "aria INPUT:Tore für den Sieger",
      "aria INPUT:Tore für den Verlierer",
      "aria spinbutton:Beginn",
      "aria spinbutton:Ende",
      "name rules.erlaubte_stufen",
      "star Beginn suppressed",
      "star Ende suppressed",
      "star Tore für den Sieger suppressed",
      "star Tore für den Verlierer suppressed",
    ],
  },
  "the matchday editor": {
    module: "features/spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx",
    marks: async () => {
      const { AdminSpieltagEditForm } = await import("@/features/spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx");
      return marksOf(
        h(AdminSpieltagEditForm, {
          spieltag: {
            id: "68c1f0a2b3c4d5e6f7a8b9e0",
            label: "1. Spieltag",
            beginn: "2026-09-05",
            ende: "2026-09-06",
            anzahl_spiele: 4,
            saison_phase: "gruppenphase",
            saison_id: "2026",
            position: 1,
            spieleAngelegt: 4,
          },
          saisonSpan: { start: "2026-08-01", end: "2027-06-30" },
          pageHeader: { title: "1. Spieltag" },
        } as never),
      );
    },
    expected: ["aria spinbutton:Beginn", "aria spinbutton:Ende"],
  },
  "the match editor, open and as a level knockout result with a venue and a referee": {
    module: "features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx",
    marks: async () => {
      const { AdminEditSpielDataForm } = await import("@/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx");
      const editor = (spiel: unknown) =>
        h(AdminEditSpielDataForm, {
          spielData: spiel,
          teams: [],
          spielorte: [VENUE],
          schiedsrichter: [REFEREE],
          saisonSpiele: [spiel],
          numberOfGroups: 2,
          isFinishedSaison: false,
          today: "2026-09-14",
          categorize: () => new Set<never>(),
          pageHeader: { title: "Spiel 1" },
        } as never);
      const open = await marksOf(editor(spielFields({ id: "6890a1b2c3d4e5f607182901", saison_id: "2026" })));
      document.body.innerHTML = "";
      const level = await marksOf(editor(LEVEL_KNOCKOUT));

      return [...open.map((mark) => `open ${mark}`), ...level.map((mark) => `level ${mark}`)];
    },
    expected: [
      "level aria INPUT:Honorar",
      "level aria INPUT:Mietpreis",
      "level aria INPUT:SG Alpha: Treffer",
      "level aria INPUT:SG Beta: Treffer",
      "open aria INPUT:Honorar",
      "open aria INPUT:Mietpreis",
    ],
  },
  "the sign-in card": {
    module: "features/auth/components/forms/SignInForm.tsx",
    marks: async () => {
      const { SignInForm } = await import("@/features/auth/components/forms/SignInForm.tsx");
      return marksOf(h(SignInForm), async (into) => {
        const tab = screen.queryByRole("tab", { name: /Spieler/ });
        if (tab === null) return;
        await userEvent.setup().click(tab);
        await settle();
        marksOn(into);
      });
    },
    expected: ["name email", "star E-Mail-Adresse suppressed"],
  },
  "the application, in its new-school branch too": {
    module: "features/bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx",
    marks: async () => {
      const { BewerbungForm } = await import("@/features/bewerbungen/components/forms/BewerbungForm/BewerbungForm.tsx");
      const { SCHULE_NICHT_IN_LISTE } = await import("@/features/bewerbungen/constants.ts");
      return marksOf(
        h(BewerbungForm, {
          saisonId: "2026",
          schulen: [{ id: "68d0f2a4c1e2b3a4d5e6f708", name: "Lessing-Kolleg" }],
          isSchulenLesbar: true,
          vergebeneFarben: [],
        } as never),
        async (into) => {
          await openEverySwitch(into);
          const picker = document.querySelector<HTMLSelectElement>('select[name="team_id"]');
          assert.ok(picker !== null, "the application renders no school picker, so its new-school branch goes unread");
          await userEvent.setup().selectOptions(picker, SCHULE_NICHT_IN_LISTE);
          await settle();
          marksOn(into);
          await openEverySwitch(into);
        },
      );
    },
    expected: [
      "aria INPUT:Davon im Verein aktiv (mind. Verbandsliga)",
      "aria INPUT:Größe der Stufe",
      "aria INPUT:Voraussichtliche Kadergröße",
      "name kontakte.ansprechperson.einwilligung.erteilt",
      "name kontakte.ansprechperson.email",
      "name kontakte.ansprechperson.nachname",
      "name kontakte.ansprechperson.telefon",
      "name kontakte.ansprechperson.vorname",
      "name kontakte.stellvertretung.email",
      "name kontakte.stellvertretung.nachname",
      "name kontakte.stellvertretung.telefon",
      "name kontakte.stellvertretung.vorname",
      "name kontakte.trainer.email",
      "name kontakte.trainer.nachname",
      "name kontakte.trainer.telefon",
      "name kontakte.trainer.vorname",
      "name schule.address.plz",
      "name schule.address.stadt",
      "name schule.address.stadtteil",
      "name schule.address.strasse",
      "name schule.full_name",
      "name schule.shorthand",
      "name schule.team_name",
      "star Davon im Verein aktiv (mind. Verbandsliga) drawn",
      "star Deine Schule drawn",
      "star E-Mail drawn",
      "star Größe der Stufe drawn",
      "star Nachname drawn",
      "star PLZ drawn",
      "star Schulform drawn",
      "star Stadt drawn",
      "star Stadtteil drawn",
      "star Straße drawn",
      "star Teamname drawn",
      "star Telefon drawn",
      "star Vollständiger Schulname drawn",
      "star Voraussichtliche Kadergröße drawn",
      "star Vorname drawn",
      "star Wunschfarbe (Trikot) drawn",
      "star Wunschkürzel drawn",
    ],
  },
  "the contact person's confirmation": {
    module: "features/bewerbungen/components/views/BestaetigungFormPanel.tsx",
    marks: async () => {
      const { BestaetigungFormPanel } = await import("@/features/bewerbungen/components/views/BestaetigungFormPanel.tsx");
      return marksOf(
        h(BestaetigungFormPanel, {
          token: "kein-echtes-token",
          vorname: "Mira",
          schule: "Lessing-Kolleg",
          saison: "2026",
          rolle: "Ansprechperson",
          mindestalter: 18,
          onAbschluss: () => undefined,
        } as never),
        async (into) => {
          await typeFirstDate(30, into);
          await openEverySwitch(into);
          await pressEveryRadio(into);
        },
      );
    },
    expected: ["aria spinbutton:Dein Geburtsdatum", "star Dein Geburtsdatum drawn"],
  },
  "the registration": {
    module: "features/registrierungen/components/views/RegistrierungFormPanel.tsx",
    marks: async () => {
      const { RegistrierungFormPanel } = await import("@/features/registrierungen/components/views/RegistrierungFormPanel.tsx");
      return marksOf(
        h(RegistrierungFormPanel, {
          token: "kein-echtes-token",
          ansicht: {
            acknowledged: 1,
            team: "Lessing-Kolleg",
            schule: "Lessing-Kolleg Oberstufengymnasium",
            saison_id: "2026",
            saison_status: "future",
            laeuft: true,
            erlaubte_stufen: ["Q1", "Q2"],
            kader_frei: true,
            team_eingetragen: true,
            nachnominierung: false,
          },
          onLinkTot: () => undefined,
        } as never),
      );
    },
    expected: ["name email", "name nachname", "name vorname", "star E-Mail drawn", "star Nachname drawn", "star Vorname drawn"],
  },
  "the triage strip's reseat and correction": {
    module: "features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx",
    marks: async () => {
      const { BewerbungBestaetigungStrip } = await import("@/features/bewerbungen/components/views/BewerbungBestaetigungStrip.tsx");
      return marksOf(
        h(BewerbungBestaetigungStrip, {
          bewerbungId: "68d0f2a4c1e2b3a4d5e6f708",
          staende: await staende(),
          frist: "2099-12-31",
          isOpen: true,
          isDirty: false,
          onGetipptChange: () => undefined,
        } as never),
        async (into) => {
          const user = userEvent.setup();
          const reseat = screen.queryByRole("button", { name: "Trainer neu besetzen" });
          assert.ok(reseat !== null, "the strip offers no reseat, so its form goes unread");
          await user.click(reseat);
          await settle();
          marksOn(into);
          for (const button of screen.queryAllByRole("button", { name: /korrigieren|ändern/i })) {
            await user.click(button);
            await settle();
            marksOn(into);
          }
        },
      );
    },
    expected: [
      "name email",
      "name nachname",
      "name telefon",
      "name vorname",
      "star E-Mail suppressed",
      "star Nachname suppressed",
      "star Neue E-Mail-Adresse suppressed",
      "star Telefon suppressed",
      "star Vorname suppressed",
    ],
  },
  "the player's confirmation": {
    module: "features/registrierungen/components/views/SpielerBestaetigungView.tsx",
    marks: async () => {
      const { SPIELER_EINWILLIGUNG } = await import("@/core/einwilligung.ts");
      const { SpielerBestaetigungView } = await import("@/features/registrierungen/components/views/SpielerBestaetigungView.tsx");
      const fassung = {
        textVersion: SPIELER_EINWILLIGUNG.textVersion,
        absaetze: SPIELER_EINWILLIGUNG.absaetzeNachSchluessel,
        schalter: SPIELER_EINWILLIGUNG.schalter,
        bedienelemente: SPIELER_EINWILLIGUNG.bedienelemente,
      };
      const ansicht = {
        acknowledged: 1,
        zustand: "gueltig",
        team: "Lessing-Kolleg",
        schule: "Lessing-Kolleg Oberstufengymnasium",
        saison_id: "2026",
        vorname: "Mira",
        text_version: fassung.textVersion,
        mindestalter: 16,
        medien_mindestalter: 18,
        geburtsdatum: null,
        umfang: null,
        medien: null,
      };
      return marksOf(
        h(SpielerBestaetigungView, { start: { zustand: "gueltig", ansicht, token: "kein-echtes-token" }, fassung } as never),
        async (into) => {
          await typeFirstDate(20, into);
          await pressEveryRadio(into);
          await openEverySwitch(into);
        },
      );
    },
    expected: [
      "aria spinbutton:Dein Geburtsdatum",
      "name umfang",
      "star Dein Geburtsdatum drawn",
      "star Was darf von Deinem Namen auf der Website stehen? drawn",
    ],
  },
  "the referee's confirmation": {
    module: "features/schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx",
    marks: async () => {
      const { SCHIEDSRICHTER_EINWILLIGUNG } = await import("@/core/einwilligung.ts");
      const { SchiedsrichterBestaetigungView } = await import("@/features/schiedsrichter/components/views/SchiedsrichterBestaetigungView.tsx");
      return marksOf(
        h(SchiedsrichterBestaetigungView, {
          start: {
            zustand: "gueltig",
            token: "abc123",
            ansicht: {
              acknowledged: 1,
              zustand: "gueltig",
              vorname: "Anna",
              text_version: SCHIEDSRICHTER_EINWILLIGUNG.textVersion,
              mindestalter: 16,
              medien_mindestalter: 18,
              frist: "2026-10-05",
            },
          },
        } as never),
        async (into) => {
          await typeFirstDate(20, into);
          await pressEveryRadio(into);
          await openEverySwitch(into);
        },
      );
    },
    expected: [
      "aria spinbutton:Dein Geburtsdatum",
      "name umfang",
      "star Dein Geburtsdatum drawn",
      "star Was darf im Spielplan von Deinem Namen stehen? drawn",
    ],
  },
  "the season create form": {
    module: "features/saisons/components/forms/AdminCreateSaisonForm.tsx",
    marks: async () => {
      const { AdminCreateSaisonForm } = await import("@/features/saisons/components/forms/AdminCreateSaisonForm.tsx");
      return marksOf(h(AdminCreateSaisonForm, { onClose: () => undefined }));
    },
    expected: [
      "aria INPUT:Maximale Kadergröße",
      "aria INPUT:Punkte für ein Unentschieden",
      "aria INPUT:Punkte für einen Sieg",
      "aria INPUT:Teams pro Gruppe",
      "aria INPUT:Tore für den Sieger",
      "aria INPUT:Tore für den Verlierer",
      "aria spinbutton:Beginn",
      "aria spinbutton:Ende",
      "name id",
      "name rules.erlaubte_stufen",
      "star Beginn drawn",
      "star Ende drawn",
      "star Gruppen drawn",
      "star Maximale Kadergröße drawn",
      "star Punkte für ein Unentschieden drawn",
      "star Punkte für einen Sieg drawn",
      "star Qualifikanten pro Gruppe drawn",
      "star Saison-ID drawn",
      "star Teams pro Gruppe drawn",
      "star Tore für den Sieger drawn",
      "star Tore für den Verlierer drawn",
      "star Was zuerst entscheidet drawn",
    ],
  },
  "the referee create form": {
    module: "features/schiedsrichter/components/forms/AdminCreateSchiedsrichterForm.tsx",
    marks: async () => {
      const { AdminCreateSchiedsrichterForm } = await import("@/features/schiedsrichter/components/forms/AdminCreateSchiedsrichterForm.tsx");
      return marksOf(h(AdminCreateSchiedsrichterForm, { onClose: () => undefined }));
    },
    expected: [
      "aria INPUT:Standard-Honorar",
      "name kontakt.email",
      "name name",
      "star E-Mail drawn",
      "star Name drawn",
      "star Standard-Honorar drawn",
    ],
  },
  "the block dialog": {
    module: "features/sperrliste/components/forms/AdminCreateSperreForm.tsx",
    marks: async () => {
      const { AdminCreateSperreForm } = await import("@/features/sperrliste/components/forms/AdminCreateSperreForm.tsx");
      return marksOf(h(AdminCreateSperreForm, { onClose: () => undefined }));
    },
    expected: ["name email", "name grund", "star E-Mail drawn", "star Grund drawn"],
  },
  "the venue create form": {
    module: "features/spielorte/components/forms/AdminCreateSpielortForm.tsx",
    marks: async () => {
      const { AdminCreateSpielortForm } = await import("@/features/spielorte/components/forms/AdminCreateSpielortForm.tsx");
      return marksOf(h(AdminCreateSpielortForm, { onClose: () => undefined }));
    },
    expected: [
      "aria INPUT:Standard Mietpreis",
      "name address.plz",
      "name address.stadt",
      "name address.strasse",
      "name name",
      "star Name drawn",
      "star PLZ drawn",
      "star Stadt drawn",
      "star Standard Mietpreis drawn",
      "star Straße drawn",
    ],
  },
  "the club create form": {
    module: "features/teams/components/forms/AdminCreateTeamForm.tsx",
    marks: async () => {
      const { AdminCreateTeamForm } = await import("@/features/teams/components/forms/AdminCreateTeamForm.tsx");
      return marksOf(
        h(AdminCreateTeamForm, {
          saisonOptions: [{ saisonId: "2026", offer: OFFER }],
          defaultSaisonId: "2026",
          onClose: () => undefined,
        } as never),
      );
    },
    expected: [
      "name address.plz",
      "name address.stadt",
      "name address.strasse",
      "name full_name",
      "name name",
      "name shorthand",
      "star Gruppe drawn",
      "star Kürzel drawn",
      "star Name drawn",
      "star PLZ drawn",
      "star Saison drawn",
      "star Stadt drawn",
      "star Straße drawn",
      "star Vollständiger Name drawn",
    ],
  },
};

describe("the required marks every form carries", () => {
  for (const [form, { marks, expected }] of Object.entries(FORMS)) {
    it(`${form} carries its schema's marks and no others`, async () => {
      assert.deepEqual((await marks()).sort(), [...expected].sort());
    });
  }
});

const SRC = path.resolve(import.meta.dirname, "..", "..");

/** Every module rendering the shared `Form` or `EntityForm`, read off its syntax tree; `EntityForm` itself is reached through each consumer. */
const FORM_MODULES = filesUnder(SRC, (name) => name.endsWith(".tsx") && !isTestFile(name), 200)
  .filter((file) => {
    const source = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let renders = false;
    const visit = (node: ts.Node): void => {
      if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && ["Form", "EntityForm"].includes(node.tagName.getText(source)))
        renders = true;
      ts.forEachChild(node, visit);
    };
    visit(source);

    return renders;
  })
  .map((file) => path.relative(SRC, file).split(path.sep).join("/"))
  .filter((file) => file !== "shared/components/ui/EntityForm.tsx");

describe("the forms whose marks are held above", () => {
  /* A form added beside these reads its marks off a schema nothing here checks until it is named. */
  it("are every module rendering the shared form or the create dialog's", () => {
    assert.ok(FORM_MODULES.length > 0, "the tree yields no form, so the equality below compares nothing");
    assert.deepEqual([...new Set(Object.values(FORMS).map((entry) => entry.module))].sort(), [...FORM_MODULES].sort());
  });
});
