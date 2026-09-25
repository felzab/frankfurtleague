import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";

import type { FLKontaktperson } from "@/features/teams/schemas.ts";
import type { UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";

/** Every write is refused unless a case answers otherwise, so no editor leaves the page a case reads. */
const REFUSED = () => Promise.resolve({ success: false, error: "Nicht gespeichert." });

const { answerWith } = doubleActions({ modules: [/\/src\/features\/\w+\/actions\.ts$/], answer: REFUSED });

doubleToasts();

/*
 Every page-owned editor, rendered over a stored row and each reached with `await import` inside its render:
 the doubles above, the dom and the JSX compile step have to stand before the editor's graph loads.
*/

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
  await enter(user, field, value);
  await act(async () => field.blur());
}

/** Entered over what the box held, and never left: what a field shows while the reader is still in it. */
async function enter(user: UserEvent, field: HTMLElement, value: string): Promise<void> {
  await user.clear(field);
  if (value !== "") await user.paste(value);
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

/** The press on Speichern, and the write's answer settling. */
async function save(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Speichern" }));
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const confirmation = (): HTMLElement | null => screen.queryByRole("button", { name: "Trotzdem speichern" });

/** The press on Speichern with every dialog it raises confirmed, and the write's answer settled. */
async function saveThrough(user: UserEvent): Promise<void> {
  await save(user);
  const asked = confirmation();
  if (asked !== null) await user.click(asked);
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

const ADDRESS = { strasse: "Am Sportpark", hausnummer: "1", plz: "60435", stadtteil: "Nordend", stadt: "Frankfurt am Main" };

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
  /** A second edit, after that change, which the editor's own schema refuses, and which leaves the control. */
  refuse: (user: UserEvent, container: HTMLElement) => Promise<void>;
  /** Puts back a value the schema takes where `refuse` broke one, without leaving the control. */
  fix: (user: UserEvent, container: HTMLElement) => Promise<void>;
  /** The write the press sends, among every action the editor's slice exports. */
  write: string;
};

/** Every page-owned editor, under its module path below `features/`. */
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
    fix: (user) => enter(user, box("PLZ"), "60435"),
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
            // A real address: the payload requires one, so a row stored without it refuses every save at the box.
            kontakt: { email: "pia@example.org", telefon: null },
            default_payment: 25,
            geburtsdatum: null,
            einwilligung: null,
            bestaetigung: null,
          },
          isRetired: false,
          pageHeader: { title: "Pia Kraft" },
        }),
      );
    },
    change: (user) => typeInto(user, box("Name"), "Pia Kraft-Meier"),
    refuse: (user) => typeInto(user, box("E-Mail"), "pia@"),
    fix: (user) => enter(user, box("E-Mail"), "pia@example.org"),
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
            nachnominierungLaeuft: null,
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
    fix: (user) => enter(user, box("Nummer"), "7"),
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
    fix: (user) => enter(user, box("PLZ"), "60435"),
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
    fix: (user) => enter(user, seatBox(0, "E-Mail"), "grace@example.org"),
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
            rules: {
              win_points: 3,
              draw_points: 1,
              qualifiers_per_group: 2,
              number_of_groups: 2,
              teams_per_group: 4,
              max_kadergroesse: 18,
              tiebreak_order: "tordifferenz",
              forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
              erlaubte_stufen: ["E1", "Q1"],
            },
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
    fix: (user) => enter(user, box("Maximale Kadergröße"), "18"),
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
    refuse: async (user, container) => {
      for (let step = 0; step < 3; step++) await stepLastDay(user, "ArrowDown");
      // Left as a reader leaves it, so the end is judged.
      await act(async () => (container.ownerDocument.activeElement as HTMLElement | null)?.blur());
    },
    // A date is re-judged, both ends at once, on its own change: the forgiveness this case reads elsewhere
    // shows nothing here, and the fix stands only for the refusal's retraction.
    fix: async (user) => {
      for (let step = 0; step < 3; step++) await stepLastDay(user, "ArrowUp");
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
        saison_phase: "gruppenphase" as const,
        saison_id: "2026",
        notiz: null,
      };

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
      const { NOTIZ_MAX_LENGTH } = await import("@/features/spiele/constants.ts");
      const notiz = box("Notiz zum Spiel");
      fireEvent.change(notiz, { target: { value: "x".repeat(NOTIZ_MAX_LENGTH + 1) } });
      fireEvent.blur(notiz);
    },
    fix: async () => {
      fireEvent.change(box("Notiz zum Spiel"), { target: { value: "Halle getauscht" } });
    },
    write: "patchAdminSpielDataAction",
  },
};

/** Whether any control in the page is shown refused, by the mark react-aria sets on it. */
const anyMarked = (container: HTMLElement): boolean => container.querySelector('[aria-invalid="true"]') !== null;

const FIELD_ROOTS = '[data-slot="textfield"], [data-slot="number-field"], [data-slot="date-picker"]';

/**
 * The field root a payload path is rendered in, which is what carries the mark: a number field's and a
 * date field's named input is hidden, the number field's standing beside its root rather than in it.
 */
function fieldOf(container: HTMLElement, path: string): Element {
  const control = container.querySelector(`[name="${path}"]`) ?? assert.fail(`the editor renders no control named ${path}`);
  const beside = control.previousElementSibling;

  return control.closest(FIELD_ROOTS) ?? (beside?.matches(FIELD_ROOTS) === true ? beside : control);
}

/** Whether the control carrying this payload path is shown refused. */
const marked = (container: HTMLElement, path: string): boolean => {
  const field = fieldOf(container, path);

  return field.getAttribute("data-invalid") === "true" || field.getAttribute("aria-invalid") === "true";
};

/** Focused and left again with nothing typed, as a reader tabs through a field. */
async function leaveUnchanged(container: HTMLElement, path: string): Promise<void> {
  const field = fieldOf(container, path);
  const target = field.matches("input, textarea")
    ? (field as HTMLElement)
    : (field.querySelector<HTMLElement>("input:not([type=hidden]), textarea") ?? assert.fail(`${path} renders nothing to enter`));

  await act(async () => target.focus());
  await act(async () => target.blur());
}

/**
 * Per editor, a control whose value a save leaves valid for the server to refuse, and the change that
 * makes the save reach the write half holding it. Named by the payload path the control carries.
 */
const SERVER_REFUSES: Record<
  string,
  {
    path: string;
    change?: (user: UserEvent, container: HTMLElement) => Promise<void>;
    /** Visits the refused field and leaves it holding what it held; a blur on it by default. */
    revisit?: (user: UserEvent, container: HTMLElement) => Promise<void>;
  }
> = {
  "spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx": { path: "name" },
  "schiedsrichter/components/forms/AdminSchiedsrichterEditForm/AdminSchiedsrichterEditForm.tsx": { path: "name" },
  "spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx": { path: "nummer" },
  "teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx": {
    path: "address.plz",
    change: (user) => typeInto(user, box("PLZ"), "60436"),
  },
  "kontakte/components/forms/AdminKontakteEditForm/AdminKontakteEditForm.tsx": { path: "kontakte.ansprechperson.vorname" },
  "saisons/components/forms/AdminSaisonEditForm/AdminSaisonEditForm.tsx": { path: "rules.max_kadergroesse" },
  // The end stepped away and back rather than the start left: a date field judges on change, never on blur,
  // and react-aria drops a server error on a date field's own blur whatever this editor recorded.
  "spieltage/components/forms/AdminSpieltagEditForm/AdminSpieltagEditForm.tsx": {
    path: "beginn",
    revisit: async (user) => {
      const ende = screen.getAllByRole("spinbutton", { name: /^Tag/ }).at(-1) ?? assert.fail("the editor renders no end to step");
      await act(async () => ende.focus());
      await user.keyboard("{ArrowUp}{ArrowDown}");
    },
  },
  "spiele/components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx": { path: "notiz" },
};

const FEATURES = path.resolve(import.meta.dirname, "..");

/** Every page-owned editor in the tree, found by the save confirmation each renders rather than by this file's keys. */
const EDITORS_IN_THE_TREE = filesUnder(FEATURES, (name) => name.endsWith(".tsx") && !isTestFile(name), 100)
  .filter((file) => readFileSync(file, "utf8").includes("<ConfirmSaveModal"))
  .map((file) => path.relative(FEATURES, file).split(path.sep).join("/"))
  .sort();

describe("a page-owned editor's field errors", () => {
  /* An editor added beside these is pressed by no case below, and one dropped from here passes over nothing. */
  it("are asked of every page-owned editor", () => {
    assert.deepEqual(Object.keys(EDITORS).sort(), EDITORS_IN_THE_TREE);
    assert.deepEqual(Object.keys(SERVER_REFUSES).sort(), EDITORS_IN_THE_TREE);
  });

  for (const [file, editor] of Object.entries(EDITORS)) {
    /* An editor re-judging only on blur keeps painting a fixed field until the admin leaves it; one
       recording a refusal without the payload it answered reads every later blur as a change, and the
       blur on the refused field deletes the server's message while the value it refused still stands. */
    it(`${file} clears a fixed field at once, and keeps the server's refusal through an unchanged blur`, async () => {
      const user = userEvent.setup();
      const container = await editor.render();

      await editor.refuse(user, container);
      // Pressed, so an emptied field is marked too, which a blur alone leaves quiet until the first press.
      await save(user);
      assert.ok(anyMarked(container), "the blocked press marked nothing, so the forgiveness below is judged over nothing");
      await editor.fix(user, container);
      assert.ok(!anyMarked(container), "a field the schema takes again stays marked until it is left");

      const {
        path,
        change = editor.change,
        revisit = (_user, page) => leaveUnchanged(page, path),
      } = SERVER_REFUSES[file] ?? assert.fail(`${file} names no control for the server to refuse`);
      await change(user, container);
      answerWith(() =>
        Promise.resolve({ success: false, error: "Nicht gespeichert.", fieldErrors: { [path]: "Das hat der Server abgelehnt." } }),
      );
      await saveThrough(user);
      assert.ok(marked(container, path), "the server's refusal is not shown on the control it names");

      await revisit(user, container);
      assert.ok(marked(container, path), "a visit that changed nothing deleted the server's refusal");
    });
  }
});
