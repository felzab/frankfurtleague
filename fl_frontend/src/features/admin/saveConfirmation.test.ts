import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { NOTIZ_MAX_LENGTH } from "@/features/spiele/constants.ts";
import { doubleActions } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLSaisonRules } from "@/features/saisons/schemas.ts";
import type { FLSpielAdmin } from "@/features/spiele/schemas.ts";
import type { FLKontaktperson } from "@/features/teams/schemas.ts";
import type { UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";

/* Every write is refused, so no editor leaves the page a case reads. */
const { calls } = doubleActions({
  modules: [/\/src\/features\/\w+\/actions\.ts$/],
  answer: () => Promise.resolve({ success: false, error: "Nicht gespeichert." }),
});

/** The actions the editors have written to, in order. */
const written = (): string[] => calls.map((call) => call.action);

const APP_TOAST = `const raise = () => () => "0";
export const UNDO_TIMEOUT_MS = 1;
export const appToast = { success: raise(), warning: raise(), danger: raise(), info: raise(), pending: raise(), close: () => {}, clear: () => {} };`;

registerHooks({
  load(url, context, nextLoad) {
    // Matched on the RESOLVED url, so this holds whichever order the alias hook and this one run in.
    if (url.endsWith("/src/shared/utils/appToast.ts")) return { format: "module", source: APP_TOAST, shortCircuit: true };
    return nextLoad(url, context);
  },
});

const renderEditor = (editor: ReactNode): HTMLElement => render(underNext(editor, { search: "saison_id=2026" })).container;

/** A box by the words on its own label, as a reader finds it. */
const box = (label: string): HTMLElement => screen.getByRole("textbox", { name: label });

/**
 * One seat's box in the contacts editor, which repeats every label once per seat.
 *
 * By position because nothing else parts the three: each seat is a panel headed with its role, and a
 * heading names no control (`fl_frontend/src/shared/components/ui/PanelHeading.tsx`).
 */
const seatBox = (seat: number, label: string): HTMLElement =>
  screen.getAllByRole("textbox", { name: label })[seat] ?? assert.fail(`no seat ${String(seat)} carries a box named ${label}`);

/** Entered over what the box held, then left, as every editor judges a typed field; pasted, since each keystroke re-renders the whole editor. */
async function typeInto(user: UserEvent, field: HTMLElement, value: string): Promise<void> {
  await user.clear(field);
  if (value !== "") await user.paste(value);
  await act(async () => field.blur());
}

/* The switch's label rather than its visually hidden checkbox, which react-aria reads a click on differently from a
   person's press. */
const toggle = (user: UserEvent, words: string): Promise<void> =>
  user.click(screen.getByText(words).closest("label") ?? assert.fail(`the editor offers no switch reading „${words}“`));

/** A pick through the native `<select>` react-aria mirrors a picker into. */
const pick = (container: HTMLElement, name: string, value: string): void => {
  fireEvent.change(container.querySelector(`select[name="${name}"]`) ?? assert.fail(`the editor mirrors no picker named ${name}`), {
    target: { value },
  });
};

/** One step on the day segment of the LAST date picker on the page, as the arrow key a reader presses in it. */
async function stepLastDay(user: UserEvent, key: "ArrowUp" | "ArrowDown"): Promise<void> {
  // react-aria names a segment for its own part of the date and hangs the value off it, so the name is matched open.
  const day = screen.getAllByRole("spinbutton", { name: /^Tag/ }).at(-1) ?? assert.fail("the editor renders no day to step");
  await act(async () => day.focus());
  await user.keyboard(`{${key}}`);
}

const ADDRESS = { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" };

const RULES: FLSaisonRules = {
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

const PERSON = (vorname: string, email: string): FLKontaktperson => ({
  vorname,
  nachname: "Meier",
  email,
  telefon: "069 111",
  geburtsdatum: "1990-12-10",
  einwilligung: { umfang: "kontaktdaten", erfasst_von: "person", text_version: "1", datum: "2026-03-12", bestaetigt_am: "2026-03-14" },
});

const TEAM_A = { teamId: "68c1f0a2b3c4d5e6f7a8b9c1", name: "SG Alpha", shorthand: "SA" };
const TEAM_B = { teamId: "68c1f0a2b3c4d5e6f7a8b9c2", name: "SG Beta", shorthand: "SB" };

type Editor = {
  /** The editor rendered over a stored row. */
  render: () => Promise<HTMLElement>;
  /** A change the save confirmation asks about. */
  change: (user: UserEvent, container: HTMLElement) => Promise<void>;
  /** A second edit, after that change, which the editor's own schema refuses. */
  refuse: (user: UserEvent, container: HTMLElement) => Promise<void>;
  /** The write the press sends, among every action the editor's slice exports. */
  write: string;
};

/** Every editor rendering `ConfirmSaveModal`, under the module path it lives at, which the roster case below holds to the tree. */
const EDITORS: Record<string, Editor> = {
  "spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx": {
    render: async () => {
      const { AdminSpielortEditForm } = await import("@/features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx");

      return renderEditor(
        h(AdminSpielortEditForm, {
          spielort: { id: "68c1f0a2b3c4d5e6f7a8b9d0", name: "Sportpark Nord", address: ADDRESS, default_mietpreis: 40 },
          isRetired: false,
          pageHeader: { title: "Sportpark Nord" },
        }),
      );
    },
    change: (user) => typeInto(user, box("Name"), "Sportpark Nordwest"),
    refuse: (user) => typeInto(user, box("PLZ"), "604"),
    write: "patchSpielortAction",
  },
  "schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx": {
    render: async () => {
      const { AdminSchiedsrichterEditForm } =
        await import("@/features/schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx");

      return renderEditor(
        h(AdminSchiedsrichterEditForm, {
          schiedsrichter: {
            id: "68c1f0a2b3c4d5e6f7a8b9d1",
            name: "Pia Kraft",
            schule: null,
            kontakt: { email: null, telefon: null },
            default_payment: 25,
          },
          isRetired: false,
          pageHeader: { title: "Pia Kraft" },
        }),
      );
    },
    change: (user) => typeInto(user, box("Name"), "Pia Kraft-Meier"),
    refuse: (user) => typeInto(user, box("E-Mail"), "pia@"),
    write: "patchSchiedsrichterAction",
  },
  "spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx": {
    render: async () => {
      const { AdminSpielerEditForm } = await import("@/features/spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx");

      return renderEditor(
        h(AdminSpielerEditForm, {
          spieler: { id: "68c1f0a2b3c4d5e6f7a8b9c0", vorname: "Lena", nachname: "Meier", inactive_since: null, geburtsdatum: null },
          einwilligung: null,
          saison: {
            saisonId: "2026",
            saisonStatus: "active",
            erlaubteStufen: ["Q1"],
            membership: {
              team_id: TEAM_A.teamId,
              nummer: "10",
              position: null,
              stufe: null,
              ist_nachnominiert: false,
              rolle: null,
              inactive_since: null,
            },
          },
          teams: [TEAM_A, TEAM_B],
          membershipCount: 1,
          pageHeader: { title: "Lena Meier" },
        }),
      );
    },
    change: async (_user, container) => pick(container, "team_id", TEAM_B.teamId),
    refuse: (user) => typeInto(user, box("Nummer"), "7a"),
    write: "patchSaisonSpielerAction",
  },
  "teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx": {
    render: async () => {
      const { AdminTeamEditForm } = await import("@/features/teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx");

      return renderEditor(
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
          gruppeOffer: [
            { gruppe: "A", occupied: 1, capacity: 4 },
            { gruppe: "B", occupied: 0, capacity: 4 },
          ],
          swap: { teams: [], playedKnockoutSpiele: 0 },
          // `null` is the club that holds no junction row for the season, which is the one state
          // this sweep's fixture can take without the invite panel's own read.
          einladung: null,
          pageHeader: { title: TEAM_A.name },
        }),
      );
    },
    change: async (_user, container) => pick(container, "gruppe", "B"),
    refuse: (user) => typeInto(user, box("PLZ"), "604"),
    write: "patchSaisonTeamAction",
  },
  "kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx": {
    render: async () => {
      const { AdminKontakteEditForm } = await import("@/features/kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx");

      return renderEditor(
        h(AdminKontakteEditForm, {
          teamId: TEAM_A.teamId,
          saison: {
            saisonId: "2026",
            saisonStatus: "future",
            membership: {
              gruppe: "A",
              austritt: null,
              trikot_farbe: null,
              kontakte: {
                ansprechperson: PERSON("Grace", "grace@example.org"),
                stellvertretung: PERSON("Alan", "alan@example.org"),
                trainer: PERSON("Ada", "ada@example.org"),
                trainer_ist_zugleich: null,
              },
              kontakte_stand: "stand",
            },
          },
          pageHeader: { title: TEAM_A.name },
        }),
      );
    },
    change: (user) => toggle(user, "Stellvertretung hinterlegt"),
    refuse: (user) => typeInto(user, seatBox(0, "E-Mail"), "grace@"),
    write: "patchSaisonTeamKontakteAction",
  },
  "saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx": {
    render: async () => {
      const { AdminSaisonEditForm } = await import("@/features/saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx");

      return renderEditor(
        h(AdminSaisonEditForm, {
          saison: {
            id: "2026",
            status: "future",
            start_date: "2026-08-01",
            end_date: "2027-06-30",
            rules: RULES,
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
          pageHeader: { title: "Saison 2026" },
        }),
      );
    },
    change: async (_user, container) => pick(container, "rules.tiebreak_order", "direkter_vergleich"),
    refuse: (user) => typeInto(user, box("Maximale Kadergröße"), ""),
    write: "patchSaisonAction",
  },
  "spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx": {
    render: async () => {
      const { AdminSpieltagEditForm } = await import("@/features/spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx");

      return renderEditor(
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
        }),
      );
    },
    // The end a day later, and then three days back, which puts it before the start.
    change: (user) => stepLastDay(user, "ArrowUp"),
    refuse: async (user) => {
      for (let step = 0; step < 3; step++) await stepLastDay(user, "ArrowDown");
    },
    write: "patchSpieltagAction",
  },
  "spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx": {
    render: async () => {
      const { AdminEditSpielDataForm } = await import("@/features/spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx");
      const spiel = {
        id: "6890a1b2c3d4e5f607182901",
        spieltag_id: "6890a1b2c3d4e5f607182990",
        team1: { team_id: TEAM_A.teamId, tore: null, name: TEAM_A.name, shorthand: TEAM_A.shorthand, austritt_type: null },
        team2: { team_id: TEAM_B.teamId, tore: null, name: TEAM_B.name, shorthand: TEAM_B.shorthand, austritt_type: null },
        team1_quelle: null,
        team2_quelle: null,
        datum: null,
        uhrzeit: null,
        ort: null,
        schiedsrichter: null,
        ergebnis: null,
        elfmeterschiessen: null,
        spiel_nr: 1,
        sonderereignis: null,
        saison_phase: "gruppenphase",
        saison_id: "2026",
        notiz: null,
      } satisfies FLSpielAdmin;

      return renderEditor(
        h(AdminEditSpielDataForm, {
          spielData: spiel,
          teams: [],
          spielorte: [],
          schiedsrichter: [],
          saisonSpiele: [spiel],
          numberOfGroups: 2,
          isFinishedSaison: false,
          today: "2026-09-14",
          categorize: () => new Set<never>(),
          pageHeader: { title: "Spiel 1" },
        }),
      );
    },
    change: async (user, container) => {
      await toggle(user, "Sonderereignis eintragen");
      pick(container, "sonderereignis", "ausgefallen");
    },
    // One character past the note's cap, set rather than typed: `maxLength` stops a keyboard at the cap, and every other
    // refusal the schema holds sits behind the result fields the event just closed.
    refuse: async () => {
      const notiz = box("Notiz zum Spiel");
      fireEvent.change(notiz, { target: { value: "x".repeat(NOTIZ_MAX_LENGTH + 1) } });
      fireEvent.blur(notiz);
    },
    write: "patchAdminSpielDataAction",
  },
};

const confirmation = (): HTMLElement | null => screen.queryByRole("button", { name: "Trotzdem speichern" });

/** The press on Speichern, and the refused write's answer settling. */
async function save(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe("an editor's save confirmation", () => {
  for (const [file, editor] of Object.entries(EDITORS)) {
    /* The confirm runs the write the gate handed it: routed back through the gate the dialog raises again, and run
       beside a cleared snapshot the save goes twice. */
    it(`${file} writes once on its confirm, and raises no dialog over a draft its schema refuses`, async () => {
      const user = userEvent.setup();
      const container = await editor.render();
      await editor.change(user, container);

      calls.length = 0;
      await save(user);
      assert.deepEqual(written(), [], "the press wrote beside raising the dialog, or never reached the gate");
      await user.click(confirmation() ?? assert.fail("the change raised no save confirmation, so nothing below is judged"));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

      assert.deepEqual(written(), [editor.write], "the confirmation wrote other than once");
      // `ok` rather than `equal` on an element: a failure's report inspects both sides, and a jsdom node holds the whole window.
      assert.ok(confirmation() === null, "the confirmation raised the dialog again");

      // A save confirmation opens only over a draft every schema accepts, never ahead of the block (`docs/frontend/spec.md :: I255`).
      await editor.refuse(user, container);
      calls.length = 0;
      await save(user);

      assert.ok(confirmation() === null, "the dialog asks about a save the draft's own refusal blocks");
      assert.deepEqual(written(), [], "a draft the schema refuses was written");
    });
  }
});

const FEATURES = path.resolve(import.meta.dirname, "..");

/** Every production component under the slices, by its path below `features/`. */
function components(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return components(full);
    return entry.name.endsWith(".tsx") && !entry.name.includes(".test.") ? [path.relative(FEATURES, full).split(path.sep).join("/")] : [];
  });
}

describe("the editors this sweep confirms", () => {
  /* A roster, which no render can show: an editor added with the dialog and missing here is confirmed by
     nothing, and every case above passes without it. */
  it("are every editor rendering the save confirmation", () => {
    const raising = components(FEATURES)
      .filter((file) => readFileSync(path.join(FEATURES, file), "utf8").includes("<ConfirmSaveModal"))
      .sort();

    assert.ok(raising.length >= 5, `expected at least 5 editors raising the save confirmation, found ${String(raising.length)}`);
    assert.deepEqual(Object.keys(EDITORS).sort(), raising);
  });
});
