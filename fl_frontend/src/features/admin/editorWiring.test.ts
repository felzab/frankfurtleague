import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { act, createElement as h } from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { APIBadStatusError } from "@/core/errors.ts";
import { filesUnder, isTestFile } from "@/core/treeWalk.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { recordingRouter, underNext } from "@/shared/testing/nextContexts.ts";
import { bodyField, refusedPayload } from "@/shared/testing/refusedPayload.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";
import { toActionErrorResult } from "@/shared/utils/actionError.ts";

import type { FLKontaktperson } from "@/features/teams/schemas.ts";
import type { UserEvent } from "@testing-library/user-event";
import type { ReactNode } from "react";

/** Every write is refused unless a case answers otherwise, so no editor leaves the page a case reads. */
const REFUSED = () => Promise.resolve({ success: false, error: "Nicht gespeichert." });

const { calls, answerWith } = doubleActions({ modules: [/\/src\/features\/\w+\/actions\.ts$/], answer: REFUSED });

const { raised } = doubleToasts();

// After the doubles: the guard raises its warning through the toast module they replace.
const { DRAFT_DISCARDED } = await import("@/shared/utils/draftGuard.ts");

/** The actions the editors have written to, in order. */
const written = (): string[] => calls.map((call) => call.action);

/*
 Every page-owned editor, rendered over a stored row and each reached with `await import` inside its render:
 the doubles above, the dom and the JSX compile step have to stand before the editor's graph loads.
*/

/** Where each editor sends the browser, the undo's own departures among them. */
const { router, seen } = recordingRouter();

const renderEditor = (editor: ReactNode): HTMLElement => render(underNext(editor, { router, search: "saison_id=2026" })).container;

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

const SPIELORT = { id: "68c1f0a2b3c4d5e6f7a8b9d0", name: "Sportpark Nord", address: ADDRESS, default_mietpreis: 40 };

const SCHIEDSRICHTER = {
  id: "68c1f0a2b3c4d5e6f7a8b9d1",
  name: "Pia Kraft",
  schule: null,
  // A real address: the payload requires one, so a row stored without it refuses every save at the box.
  kontakt: { email: "pia@example.org", telefon: null },
  default_payment: 25,
  geburtsdatum: null,
  einwilligung: null,
  bestaetigung: null,
};

const SPIELER = { id: "68c1f0a2b3c4d5e6f7a8b9c0", vorname: "Lena", nachname: "Meier", inactive_since: null, geburtsdatum: null };

const SPIELER_MEMBERSHIP = {
  team_id: TEAM_A.teamId,
  nummer: "10",
  position: null,
  stufe: null,
  ist_nachnominiert: false,
  rolle: null,
  inactive_since: null,
};

/** The player's editor in the season its squad row stands in, and what the view hands it besides. */
const spielerProps = (over: { inactiveSince?: string; rowInactiveSince?: string } = {}) => ({
  spieler: { ...SPIELER, inactive_since: over.inactiveSince ?? null },
  einwilligung: null,
  saison: {
    saisonId: "2026",
    saisonStatus: "active" as const,
    erlaubteStufen: ["Q1" as const],
    nachnominierungLaeuft: null,
    membership: { ...SPIELER_MEMBERSHIP, inactive_since: over.rowInactiveSince ?? null },
  },
  teams: [TEAM_A, TEAM_B],
  membershipCount: 1,
});

const TEAM = {
  id: TEAM_A.teamId,
  name: TEAM_A.name,
  shorthand: TEAM_A.shorthand,
  description: "",
  full_name: "Sportgemeinschaft Alpha",
  website_url: null,
  address: ADDRESS,
  schulform: null,
  inactive_since: null,
};

/** A club in a season that has played nothing, as the swap reads it. */
const swapTeam = ({ teamId, name }: typeof TEAM_A, gruppe: "A" | "B") => ({
  id: teamId,
  name,
  gruppe,
  gespielteGruppenSpiele: 0,
  gruppenSpieleProSpieltag: {},
  koSpieleProSpieltag: {},
});

/** The club's editor in a planned season, entered in group A unless told otherwise, and what the view hands it besides. */
const teamProps = (over: { inactiveSince?: string; isMember?: boolean; locked?: boolean } = {}) => ({
  team: { ...TEAM, inactive_since: over.inactiveSince ?? null },
  saison: {
    saisonId: "2026",
    saisonStatus: "future" as const,
    membership:
      over.isMember === false ? null : { gruppe: "A" as const, austritt: null, trikot_farbe: null, kontakte: null, kontakte_stand: "stand" },
  },
  today: "2026-09-14",
  gruppeLocked: over.locked ?? false,
  gruppeOffer: [
    { gruppe: "A" as const, occupied: 1, capacity: 4 },
    { gruppe: "B" as const, occupied: 0, capacity: 4 },
  ],
  swap: { teams: over.locked === true ? [swapTeam(TEAM_A, "A"), swapTeam(TEAM_B, "B")] : [], playedKnockoutSpiele: 0 },
  // `null` is the club that holds no junction row for the season, which is the one state
  // this sweep's fixture can take without the invite panel's own read.
  einladung: null,
});

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

const SAISON_SCHEDULE = [
  { phase: "gruppenphase" as const, matchdays: 3, matches_per_matchday: 4 },
  { phase: "halbfinale" as const, matchdays: 1, matches_per_matchday: 2 },
  { phase: "finale" as const, matchdays: 1, matches_per_matchday: 1 },
];

/** A planned season, undrawn unless told otherwise; drawn, it holds dated matchdays and no recorded result. */
const saisonProps = (over: { drawn?: boolean } = {}) => ({
  saison: {
    id: "2026",
    status: "future" as const,
    start_date: "2026-08-01",
    end_date: "2027-06-30",
    rules: {
      win_points: 3,
      draw_points: 1,
      qualifiers_per_group: 2,
      number_of_groups: 2,
      teams_per_group: 4,
      max_kadergroesse: 18,
      tiebreak_order: "tordifferenz" as const,
      forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
      erlaubte_stufen: ["E1" as const, "Q1" as const],
    },
    bewerbung: null,
    registrierung: null,
  },
  rollover: { outgoingSaisonId: null, offeneSpiele: [], hasUndatierteSpieltage: false },
  swap: { teams: [], playedKnockoutSpiele: 0 },
  ersatz: { rows: [], candidates: [] },
  spielplan:
    over.drawn === true
      ? {
          spielplan: { generiert_am: "2026-07-01", spieltage: 5, spiele: 15 },
          spieltageCount: 5,
          schedule: SAISON_SCHEDULE,
          bestand: { spiele: 15, erfasst: 0, angesetzt: 0 },
        }
      : { spielplan: null, spieltageCount: 0, schedule: SAISON_SCHEDULE, bestand: { spiele: 0, erfasst: 0, angesetzt: 0 } },
  hasDrawnSpiele: over.drawn === true,
  spieltagBound: { startMax: null, endMin: null },
});

/** Every page-owned editor, under its module path below `features/`. */
const EDITORS: Record<string, Editor> = {
  "spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx": {
    render: async () => {
      const { AdminSpielortEditForm } = await import("@/features/spielorte/components/forms/AdminSpielortEditForm/AdminSpielortEditForm.tsx");

      return renderEditor(
        h(AdminSpielortEditForm, {
          spielort: SPIELORT,
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
          schiedsrichter: SCHIEDSRICHTER,
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
          ...spielerProps(),
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
          ...teamProps(),
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
      const { AdminSaisonEditView } = await import("@/features/saisons/components/views/AdminSaisonEditView.tsx");

      return renderEditor(h(AdminSaisonEditView, saisonProps()));
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

const FEATURES = path.resolve(import.meta.dirname, "..");

/** Every page-owned editor in the tree, found by the save confirmation each renders rather than by this file's keys. */
const EDITORS_IN_THE_TREE = filesUnder(FEATURES, (name) => name.endsWith(".tsx") && !isTestFile(name), 100)
  .filter((file) => readFileSync(file, "utf8").includes("<ConfirmSaveModal"))
  .map((file) => path.relative(FEATURES, file).split(path.sep).join("/"))
  .sort();

describe("the page-owned editors every sweep here presses", () => {
  /* An editor added beside these is pressed by no case below, and one dropped from here passes over nothing. */
  it("are every editor rendering the save confirmation", () => {
    assert.ok(EDITORS_IN_THE_TREE.length > 0, "the tree yields no editor, so the equality below compares nothing");
    assert.deepEqual(Object.keys(EDITORS).sort(), EDITORS_IN_THE_TREE);
  });
});

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

/** What the press raised at `danger`, as its title and its description. */
const failures = (): (string | undefined)[][] =>
  raised.filter((toast) => toast.variant === "danger").map((toast) => [toast.title, toast.description]);

describe("an editor's answer to a payload the API refused on a path it renders no control for", () => {
  for (const [file, editor] of Object.entries(EDITORS)) {
    /* Only a page older than the running API sends such a body, so a retry resends what was refused and a reload
       is the repair. */
    it(`${file} raises one toast, the refusal's own reload`, async () => {
      answerWith(() => Promise.resolve(toActionErrorResult(refusedPayload([bodyField(["nicht_gerendert"])]))));
      try {
        const user = userEvent.setup();
        const container = await editor.render();
        await editor.change(user, container);
        raised.length = 0;

        await saveThrough(user);

        assert.deepEqual(failures(), [["Änderung nicht gespeichert", "Einzelne Angaben wurden nicht übernommen. Lade die Seite neu."]]);
      } finally {
        answerWith(REFUSED);
      }
    });
  }
});

describe("an editor's write whose action rejected", () => {
  for (const [file, editor] of Object.entries(EDITORS)) {
    /* A dropped connection rejects the action after the POST may have reached the server: uncaught
       inside the transition, it replaces the editor with the error page and says nothing. */
    it(`${file} stays on its page, reads nothing again and raises one toast of unknown outcome`, async () => {
      answerWith(() => Promise.reject(new TypeError("Failed to fetch")));
      try {
        const user = userEvent.setup();
        const container = await editor.render();
        await editor.change(user, container);
        raised.length = 0;
        seen.refresh = 0;

        await saveThrough(user);

        // A reload would re-key the editor over its draft (`docs/frontend/spec.md` §1.3).
        assert.equal(seen.refresh, 0, "a rejected save read the page again over the editor's draft");

        assert.deepEqual(
          raised.map((toast) => [toast.variant, toast.description, toast.options?.outcome]),
          [["danger", "Ob die Änderung gespeichert wurde, ist unklar. Lade die Seite neu und prüfe, ob sie da ist.", "unknown"]],
        );
        assert.ok(screen.queryByRole("button", { name: "Speichern" }) !== null, "the rejection took the editor off the page");
      } finally {
        answerWith(REFUSED);
      }
    });
  }
});

/** The two editors writing one press through two actions, each with a change that dirties both halves. */
const TWO_HALVES: Record<string, (user: UserEvent, container: HTMLElement) => Promise<void>> = {
  "spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx": async (user, container) => {
    await typeInto(user, box("Vorname"), "Lena-Marie");
    pick(container, "team_id", TEAM_B.teamId);
  },
  "teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx": async (user, container) => {
    await typeInto(user, box("PLZ"), "60436");
    pick(container, "gruppe", "B");
  },
};

/** A box the first half of each two-part press renders, which a refusal of that half can name. */
const SHOWN_BY_FIRST_HALF: Record<string, readonly string[]> = {
  "spieler/components/forms/AdminSpielerEditForm/AdminSpielerEditForm.tsx": ["vorname"],
  "teams/components/forms/AdminTeamEditForm/AdminTeamEditForm.tsx": ["address", "plz"],
};

const UNKNOWN_COMMIT = () =>
  Promise.resolve(
    toActionErrorResult(
      new APIBadStatusError({
        message: "x",
        url: "http://backend/api/v0/x",
        statusCode: 500,
        serverErrorCode: "DB-FAIL-002",
        endpoint: "/x",
        method: "PATCH",
        readOnly: false,
        traceId: "0",
      }),
    ),
  );

/** One press of a two-part editor whose halves answer in turn, and the danger toasts it raised. */
async function pressBothHalves(
  file: string,
  change: (user: UserEvent, container: HTMLElement) => Promise<void>,
  answers: (() => Promise<unknown>)[],
) {
  answerWith(() => (answers.shift() ?? REFUSED)());
  try {
    const user = userEvent.setup();
    const container = await (EDITORS[file] ?? assert.fail(`${file} is no editor this file renders`)).render();
    await change(user, container);
    raised.length = 0;
    calls.length = 0;

    await saveThrough(user);

    assert.equal(calls.length, 2, "the press did not write both halves");
    return raised.filter((toast) => toast.variant === "danger");
  } finally {
    answerWith(REFUSED);
  }
}

describe("a two-part press whose second half nobody can tell landed", () => {
  for (const [file, change] of Object.entries(TWO_HALVES)) {
    /* One half of unknown outcome makes the whole press one: titled as saved-in-part it would call a
       change that may stand „nicht gespeichert“, the sentence the marker exists to keep off the toast. */
    it(`${file} carries the marker onto the one failure it raises, beside the half that saved`, async () => {
      const danger = await pressBothHalves(file, change, [() => Promise.resolve({ success: true, message: "Gespeichert." }), UNKNOWN_COMMIT]);

      assert.deepEqual(
        danger.map((toast) => [toast.title, toast.options?.outcome]),
        [["Nur teilweise gespeichert", "unknown"]],
      );
    });

    /* The first half's action rejecting may have written, and uncaught it takes the editor down before
       the second half runs. */
    it(`${file} carries a first half's rejected action as of unknown outcome, beside the half that saved`, async () => {
      seen.refresh = 0;
      const danger = await pressBothHalves(file, change, [
        () => Promise.reject(new TypeError("Failed to fetch")),
        () => Promise.resolve({ success: true, message: "Gespeichert." }),
      ]);

      assert.deepEqual(
        danger.map((toast) => [toast.title, toast.options?.outcome]),
        [["Nur teilweise gespeichert", "unknown"]],
      );
      assert.ok(screen.queryByRole("button", { name: "Speichern" }) !== null, "the rejection took the editor off the page");
      assert.equal(seen.refresh, 0, "a rejected half read the page again over the draft of the half not written");
    });

    /* The first half's refusal is marked on its box, which speaks for that half alone: the second half's
       unknown outcome has nowhere else to be said. */
    it(`${file} still announces the half failing with no map beside a half refused on a shown box`, async () => {
      const shown = SHOWN_BY_FIRST_HALF[file] ?? assert.fail(`${file} names no box its first half renders`);
      const danger = await pressBothHalves(file, change, [
        () => Promise.resolve(toActionErrorResult(refusedPayload([bodyField(shown)]))),
        UNKNOWN_COMMIT,
      ]);

      assert.deepEqual(
        danger.map((toast) => [toast.title, toast.options?.outcome]),
        [["Änderung nicht gespeichert", "unknown"]],
      );
    });
  }
});

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

describe("a page-owned editor's field errors", () => {
  it("name a control for the server to refuse in every editor", () => {
    assert.deepEqual(Object.keys(SERVER_REFUSES).sort(), EDITORS_IN_THE_TREE);
  });

  for (const [file, editor] of Object.entries(EDITORS)) {
    /* A fixed field clears before it is left, and the server's refusal outlives a visit that changes
       nothing: an editor re-judging on blur alone keeps painting, and one misrecording what it sent drops
       the refusal. */
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

describe("a page-owned editor's undo", () => {
  for (const [file, editor] of Object.entries(EDITORS)) {
    /* One request, to the slice's own route, answered as the proxy answers a lapsed session: only
       `fl_frontend/src/shared/utils/undoDispatch.ts :: offerUndo` then sends the admin to sign in again. */
    it(`${file} dispatches the undo its save offers through the shared dispatch, to its own slice's route`, async () => {
      // One success every editor reads its undo from: the match editor its prior pairings, the contacts
      // editor the row's new stand, without which it offers no replay at all.
      answerWith(() =>
        Promise.resolve({ success: true, message: "Gespeichert.", priorPaarungen: [], saison_team: { kontakte_stand: "nach" } }),
      );
      const user = userEvent.setup();
      const container = await editor.render();
      await editor.change(user, container);
      raised.length = 0;
      await saveThrough(user);

      const offer = raised.find((toast) => toast.options?.actionProps?.onPress !== undefined) ?? assert.fail("the save offered no undo");
      const sent: string[] = [];
      const original = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL) => {
        sent.push(String(input));
        return Promise.resolve(Response.json({ success: false, error: "Nicht angemeldet." }, { status: 401 }));
      }) as typeof fetch;
      seen.replaced.length = 0;
      try {
        await act(async () => {
          offer.options?.actionProps?.onPress?.();
          await new Promise((resolve) => setTimeout(resolve, 0));
        });
      } finally {
        globalThis.fetch = original;
      }

      assert.deepEqual(
        sent,
        [`/api/admin/${file.split("/")[0] ?? ""}/undo`],
        "the undo reached somewhere other than its own slice's route, once",
      );
      assert.deepEqual(seen.replaced, ["/signin"], "a lapsed session's undo stayed on the page, so the dispatch is not the shared one");
    });
  }
});

/** A day the record was retired on, which is what puts the reactivation in the header. */
const RETIRED_ON = "2026-01-15";

/** A control beside the save whose write moves the record the page keys its editor by. */
type RecordMove = {
  render: () => Promise<HTMLElement>;
  /** A pick the press needs before it can be pressed at all. */
  ready?: (user: UserEvent, container: HTMLElement) => Promise<void>;
  /** Typing the page then holds unsaved, outside the press's own panel. */
  type: (user: UserEvent, container: HTMLElement) => Promise<void>;
  /** The control's name at rest, and its armed name where it confirms before it writes. */
  press: string;
  armed?: string;
  /** The action the press writes through. */
  write: string;
};

const RECORD_MOVES: Record<string, RecordMove> = {
  "the venue's reactivation": {
    render: async () => {
      const { AdminSpielortEditView } = await import("@/features/spielorte/components/views/AdminSpielortEditView.tsx");

      return renderEditor(h(AdminSpielortEditView, { spielort: SPIELORT, inactiveSince: RETIRED_ON }));
    },
    type: (user) => typeInto(user, box("Name"), "Sportpark Nordwest"),
    press: "Reaktivieren",
    write: "reactivateSpielortAction",
  },
  "the referee's reactivation": {
    render: async () => {
      const { AdminSchiedsrichterEditView } = await import("@/features/schiedsrichter/components/views/AdminSchiedsrichterEditView.tsx");

      return renderEditor(h(AdminSchiedsrichterEditView, { schiedsrichter: SCHIEDSRICHTER, inactiveSince: RETIRED_ON }));
    },
    type: (user) => typeInto(user, box("Name"), "Pia Kraft-Meier"),
    press: "Reaktivieren",
    write: "reactivateSchiedsrichterAction",
  },
  "the referee's invitation": {
    render: async () => {
      const { AdminSchiedsrichterEditView } = await import("@/features/schiedsrichter/components/views/AdminSchiedsrichterEditView.tsx");

      return renderEditor(h(AdminSchiedsrichterEditView, { schiedsrichter: SCHIEDSRICHTER, inactiveSince: null }));
    },
    type: (user) => typeInto(user, box("Name"), "Pia Kraft-Meier"),
    press: "Bestätigungslink senden",
    write: "einladeSchiedsrichterAction",
  },
  "the player's reactivation": {
    render: async () => {
      const { AdminSpielerEditView } = await import("@/features/spieler/components/views/AdminSpielerEditView.tsx");

      return renderEditor(h(AdminSpielerEditView, spielerProps({ inactiveSince: RETIRED_ON })));
    },
    type: (user) => typeInto(user, box("Vorname"), "Lena-Marie"),
    press: "Reaktivieren",
    write: "reactivateSpielerAction",
  },
  "the squad row's removal": {
    render: async () => {
      const { AdminSpielerEditView } = await import("@/features/spieler/components/views/AdminSpielerEditView.tsx");

      return renderEditor(h(AdminSpielerEditView, spielerProps()));
    },
    type: (user) => typeInto(user, box("Vorname"), "Lena-Marie"),
    press: "Aus Kader 2026 austragen",
    write: "deleteSaisonSpielerAction",
  },
  "the squad row's return": {
    render: async () => {
      const { AdminSpielerEditView } = await import("@/features/spieler/components/views/AdminSpielerEditView.tsx");

      return renderEditor(h(AdminSpielerEditView, spielerProps({ rowInactiveSince: RETIRED_ON })));
    },
    type: (user) => typeInto(user, box("Vorname"), "Lena-Marie"),
    press: "Kadereintrag reaktivieren",
    write: "reactivateSaisonSpielerAction",
  },
  "the club's reactivation": {
    render: async () => {
      const { AdminTeamEditView } = await import("@/features/teams/components/views/AdminTeamEditView.tsx");

      return renderEditor(h(AdminTeamEditView, teamProps({ inactiveSince: RETIRED_ON })));
    },
    type: (user) => typeInto(user, box("PLZ"), "60436"),
    press: "Reaktivieren",
    write: "reactivateTeamAction",
  },
  "the club's season entry": {
    render: async () => {
      const { AdminTeamEditView } = await import("@/features/teams/components/views/AdminTeamEditView.tsx");

      return renderEditor(h(AdminTeamEditView, teamProps({ isMember: false })));
    },
    // The entry's own pick, which the draft leaves out: the club holds no season row for it to change.
    ready: async (_user, container) => pick(container, "gruppe", "A"),
    type: (user) => typeInto(user, box("PLZ"), "60436"),
    press: "In Saison 2026 aufnehmen",
    write: "postSaisonTeamAction",
  },
  "the club's group swap": {
    render: async () => {
      const { AdminTeamEditView } = await import("@/features/teams/components/views/AdminTeamEditView.tsx");

      return renderEditor(h(AdminTeamEditView, teamProps({ locked: true })));
    },
    ready: async (user) => {
      await user.click(screen.getByRole("button", { name: /Tauschen mit/ }));
      await user.click(screen.getByRole("option", { name: /^SG Beta/ }));
    },
    type: (user) => typeInto(user, box("PLZ"), "60436"),
    press: "Gruppen tauschen",
    armed: "Ja, Gruppen tauschen",
    write: "swapGruppenAction",
  },
  "the season's rollover, beside a redraw's moved shape": {
    render: async () => {
      const { AdminSaisonEditView } = await import("@/features/saisons/components/views/AdminSaisonEditView.tsx");

      return renderEditor(h(AdminSaisonEditView, saisonProps({ drawn: true })));
    },
    // The redraw's own boxes, outside the season's draft: the save bar never sends a `shape.` path.
    type: async (user, container) => {
      await user.click(screen.getByRole("radio", { name: "Neu anlegen" }));
      pick(container, "shape.qualifiers_per_group", "1");
    },
    press: "Auf Saison 2026 umstellen",
    armed: "Ja, auf 2026 umstellen",
    write: "activateSaisonAction",
  },
};

/** The page rendered, with the press ready to be pressed. */
async function readied(user: UserEvent, move: RecordMove): Promise<HTMLElement> {
  const container = await move.render();
  await move.ready?.(user, container);
  return container;
}

/** The press, through its confirmation where it asks one, and whatever it started settling. */
async function pressThrough(user: UserEvent, { press, armed }: RecordMove): Promise<void> {
  if (armed === undefined) await user.click(screen.getByRole("button", { name: press }));
  else await pressTwice(user, { resting: press, armed });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

describe("a press whose write moves the record the page keys its editor by", () => {
  for (const [name, move] of Object.entries(RECORD_MOVES)) {
    /* The write's refresh remounts the editor on the moved record, so a press over unsaved typing throws the
       typing away unasked. The clean press writes, so the refusal below is the typing's alone. */
    it(`${name} refuses over unsaved typing, naming the typing's loss, and writes over none`, async () => {
      const user = userEvent.setup();
      await readied(user, move);
      calls.length = 0;
      await pressThrough(user, move);
      assert.deepEqual(written(), [move.write], "the press over a clean editor did not write, so the refusal below judges nothing");

      cleanup();
      await move.type(user, await readied(user, move));
      calls.length = 0;
      raised.length = 0;
      await user.click(screen.getByRole("button", { name: move.press }));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

      assert.deepEqual(written(), [], "the press wrote over the unsaved typing");
      assert.deepEqual(
        raised.map((toast) => [toast.variant, toast.title, toast.description]),
        [["warning", "Erst speichern", DRAFT_DISCARDED]],
      );
    });
  }
});

/** Four clubs in each of the season's two groups, so a redraw stands open. */
const FULL_GROUPS = (["A", "B"] as const).flatMap((gruppe) =>
  [1, 2, 3, 4].map((platz) => ({
    teamId: `68c1f0a2b3c4d5e6f7a8b${gruppe === "A" ? "a" : "b"}0${String(platz)}`,
    name: `Schule ${gruppe}${String(platz)}`,
    gruppe: gruppe,
    spiele: 3,
    gespielteSpiele: 0,
    hasAustritt: false,
    isVerwaist: false,
  })),
);

/** The season page as its route renders it: the view holding the redraw's typing above the editor it keys. */
async function renderSaisonPage(): Promise<{ container: HTMLElement; rerenderSaved: () => Promise<void> }> {
  const { AdminSaisonEditView } = await import("@/features/saisons/components/views/AdminSaisonEditView.tsx");
  const page = (saved: boolean): ReactNode => {
    const props = { ...saisonProps({ drawn: true }), ersatz: { rows: FULL_GROUPS, candidates: [] } };
    const saison = saved ? { ...props.saison, rules: { ...props.saison.rules, tiebreak_order: "direkter_vergleich" as const } } : props.saison;

    return underNext(h(AdminSaisonEditView, { ...props, saison: saison }), { router, search: "saison_id=2026" });
  };
  const { container, rerender } = render(page(false));

  // What the save's refresh hands the page: the stored record moved, which re-keys the editor under the view.
  return { container, rerenderSaved: () => act(async () => void rerender(page(true))) };
}

/** A redraw's shape moved: the replace picked, and one of its boxes off the stored three. */
async function moveShape(user: UserEvent, container: HTMLElement): Promise<void> {
  await user.click(screen.getByRole("radio", { name: "Neu anlegen" }));
  pick(container, "shape.qualifiers_per_group", "1");
}

const shapeValue = (container: HTMLElement): string | undefined =>
  container.querySelector<HTMLSelectElement>('select[name="shape.qualifiers_per_group"]')?.value;

/** Whether the page's leave prompt would stop a reload now. */
function leavePromptAsks(): boolean {
  const unload = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(unload);
  return unload.defaultPrevented;
}

const discardDialog = (): HTMLElement | null => screen.queryByRole("alertdialog", { name: "Änderungen verwerfen?" });

const departures = (): number => seen.back + seen.pushed.length;

describe("a season page holding a redraw's moved shape", () => {
  /* The shape is typing the save never sends, and every way off the page drops it: counted apart from the draft, a
     save, a cancel or a reload would take it without a word. */
  it("counts the shape as unsaved, so the leave prompt asks over it alone", async () => {
    const user = userEvent.setup();
    const { container } = await renderSaisonPage();
    assert.equal(leavePromptAsks(), false, "the clean page already asks, so nothing below is judged");

    await moveShape(user, container);

    assert.equal(leavePromptAsks(), true, "a moved shape left the page free to unload");
  });

  it("asks on Abbrechen instead of leaving, and leaves on Verwerfen", async () => {
    const user = userEvent.setup();
    const { container } = await renderSaisonPage();
    await moveShape(user, container);
    seen.back = 0;
    seen.pushed.length = 0;

    await user.click(screen.getByRole("button", { name: "Abbrechen" }));

    assert.equal(departures(), 0, "Abbrechen left over the moved shape");
    assert.match(discardDialog()?.textContent ?? "", /1 Änderung ist noch nicht gespeichert/);

    await user.click(screen.getByRole("button", { name: "Verwerfen" }));
    assert.equal(departures(), 1, "Verwerfen did not leave");
  });

  /* The save's refresh remounts the editor on the stored record, so a dialog or a shape the editor held itself would
     go with it; the case hands the page that refresh. */
  it("asks on Speichern's exit, and keeps the shape through the refresh that re-keys the editor", async () => {
    answerWith(() => Promise.resolve({ success: true, message: "Gespeichert." }));
    try {
      const user = userEvent.setup();
      const { container, rerenderSaved } = await renderSaisonPage();
      pick(container, "rules.tiebreak_order", "direkter_vergleich");
      await moveShape(user, container);
      seen.back = 0;
      seen.pushed.length = 0;
      calls.length = 0;

      await saveThrough(user);
      await rerenderSaved();

      assert.deepEqual(written(), ["patchSaisonAction"], "the save did not write, so its exit is not judged");
      assert.equal(departures(), 0, "the save left over the moved shape");
      assert.match(discardDialog()?.textContent ?? "", /1 Änderung ist noch nicht gespeichert/);

      await user.click(screen.getByRole("button", { name: "Weiter bearbeiten" }));

      assert.ok(discardDialog() === null, "Weiter bearbeiten left the dialog open");
      assert.equal(shapeValue(container), "1", "the shape did not survive the save");
      assert.equal(departures(), 0);
    } finally {
      answerWith(REFUSED);
    }
  });

  /* The draw is made from the shape, so counted with the draft its own guard would refuse every redraw that moves one. */
  it("arms the redraw over its own shape, and refuses it over the draft alone", async () => {
    const user = userEvent.setup();
    const { container } = await renderSaisonPage();
    await moveShape(user, container);
    raised.length = 0;

    await user.click(screen.getByRole("button", { name: "Spielplan neu anlegen" }));

    assert.equal(raised.length, 0, "the redraw refused over the shape it is made from");
    assert.ok(screen.queryByRole("button", { name: "Ja, löschen und neu anlegen" }) !== null, "the redraw did not arm");

    cleanup();
    const again = await renderSaisonPage();
    await moveShape(user, again.container);
    pick(again.container, "rules.tiebreak_order", "direkter_vergleich");
    raised.length = 0;

    await user.click(screen.getByRole("button", { name: "Spielplan neu anlegen" }));

    assert.deepEqual(
      raised.map((toast) => [toast.variant, toast.title, toast.description]),
      [["warning", "Erst speichern", "Der Spielplan entsteht aus den gespeicherten Regeln, nicht aus den getippten."]],
    );
  });

  /* The shape's counting may not reach a page with none: a page that asked over nothing would train the dialog away. */
  it("stays as it was with no shape typed, or with one the pick hides", async () => {
    answerWith(() => Promise.resolve({ success: true, message: "Gespeichert." }));
    try {
      const user = userEvent.setup();
      const { container } = await renderSaisonPage();
      await moveShape(user, container);
      await user.click(screen.getByRole("radio", { name: "Zurücknehmen" }));
      assert.equal(leavePromptAsks(), false, "a shape the pick hides counts as typing");

      pick(container, "rules.tiebreak_order", "direkter_vergleich");
      seen.back = 0;
      seen.pushed.length = 0;
      await saveThrough(user);
      assert.equal(departures(), 1, "the save over the draft alone did not leave");
      assert.ok(discardDialog() === null, "the save over the draft alone asked");

      cleanup();
      await renderSaisonPage();
      seen.back = 0;
      seen.pushed.length = 0;
      await user.click(screen.getByRole("button", { name: "Abbrechen" }));
      assert.equal(departures(), 1, "Abbrechen over a clean page did not leave");
      assert.ok(discardDialog() === null, "Abbrechen over a clean page asked");
    } finally {
      answerWith(REFUSED);
    }
  });
});
