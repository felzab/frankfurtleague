// @vitest-environment jsdom

import { createElement as h } from "react";

import { doubleActions } from "@/test-support/actionDoubles.ts";
import { declaredStatus } from "@/test-support/declaredStatus.ts";
import { underNext } from "@/test-support/nextContexts.ts";
import { saisonRules } from "@/test-support/saisonRules.ts";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { assert, describe, expect, it } from "vitest";

import type { FLSaisonRules } from "@/core/generated/client/types.ts";
import type { SaisonFieldPath } from "@/features/saisons/saisonDraftStatus.ts";

// The server action modules the season editor reaches.
doubleActions({ modules: ["@/features/einladungen/actions.ts", "@/features/saisons/actions.ts", "@/features/teams/actions.ts"] });

const { FormRegelnSection } = await import("./FormRegelnSection.tsx");
const { AdminSaisonEditView } = await import("@/features/saisons/components/views/AdminSaisonEditView.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

type RegelnProps = Parameters<typeof FormRegelnSection>[0];

const STATUS = declaredStatus<SaisonFieldPath>([
  "rules.win_points",
  "rules.draw_points",
  "rules.tiebreak_order",
  "rules.forfeit_ergebnis",
  "rules.number_of_gruppen",
  "rules.teams_per_gruppe",
  "rules.qualifiers_per_gruppe",
  "rules.max_kadergroesse",
  "rules.allowed_stufen",
]);

const RULES: FLSaisonRules = saisonRules();

/** A season neither freeze reaches, holding no club, which every case moves one fact away from. */
const PANEL: RegelnProps = {
  rules: RULES,
  onRulesChange: () => undefined,
  onFieldLeft: () => undefined,
  onStufenChange: () => undefined,
  isFinishedSaison: false,
  hasStarted: false,
  gruppenOccupancy: {},
  isDrawnSaison: false,
  spielplanWindow: "open",
  banners: [],
};

const panel = (props: Partial<RegelnProps>) =>
  h(DraftStatusProvider, { status: STATUS, children: h(FormRegelnSection, { ...PANEL, ...props }) });

const trigger = (label: RegExp): HTMLElement => screen.getByRole("button", { name: label });
const isClosed = (element: HTMLElement): boolean => element.hasAttribute("disabled");

describe("the rules panel's freezes", () => {
  /* `rules_saison_started` refuses the change on a start or a finish, so either alone closes the scoring fields. A
     finished season is answered by the standing banner the panel carries, so the start's sentence is the running
     season's alone. */
  it("closes the tiebreak and the points on a started or a finished season, and names the start's rule only while it runs", () => {
    for (const [hasStarted, isFinishedSaison, closed, explained] of [
      [false, false, false, false],
      [true, false, true, true],
      [false, true, true, false],
      [true, true, true, false],
    ] as const) {
      const { unmount } = render(panel({ hasStarted, isFinishedSaison }));
      const state = `started: ${String(hasStarted)}, finished: ${String(isFinishedSaison)}`;

      expect(isClosed(trigger(/Was zuerst entscheidet$/)), state).toBe(closed);
      expect(screen.getByRole("textbox", { name: "Punkte für einen Sieg" }).hasAttribute("readonly"), state).toBe(closed);
      expect(
        screen.queryByText("Nach dem Beginn der Saison lassen sich Punkte, Tiebreak und Qualifikanten pro Gruppe nicht mehr ändern.") !== null,
        state,
      ).toBe(explained);
      unmount();
    }
  });

  /* The qualifiers alone are in the started or finished season's freeze: the table is scored from them, and
     `rules_saison_started` names no group count. */
  it("closes each shape count where its own freeze reaches it", () => {
    for (const [props, gruppen, qualifikanten] of [
      [{}, false, false],
      [{ isDrawnSaison: true }, true, true],
      [{ isFinishedSaison: true }, false, true],
      [{ hasStarted: true }, false, true],
    ] as const) {
      const { unmount } = render(panel(props));

      expect(isClosed(trigger(/^Gruppen/)), JSON.stringify(props)).toBe(gruppen);
      expect(isClosed(trigger(/^Qualifikanten pro Gruppe/)), JSON.stringify(props)).toBe(qualifikanten);
      unmount();
    }
  });

  /* A redraw that moves the groups is out of reach while the draw stands, and nothing returns a season to `future`,
     so a repair named outside the window is one nobody can take. */
  it("names the repairs for the frozen shape inside the Spielplan window, and the freeze or its condition outside it", () => {
    const { unmount } = render(panel({}));
    // `ok` rather than `equal` on an element: a failure's report inspects both sides, and a jsdom node holds the whole window.
    assert.ok(screen.queryByText(/Spielplan/) === null, "an undrawn season is told how to unfreeze fields nothing has frozen");
    unmount();

    for (const [spielplanWindow, note] of [
      ["open", /mit der neuen Zahl neu anlegst\. .*nimmst Du den Spielplan zurück/],
      ["recorded", /Solange zu mindestens einem Spiel .* weder neu anlegen noch zurücknehmen/],
      ["closed", /lässt sich nur neu anlegen und zurücknehmen, solange die Saison geplant ist\. Damit sind diese drei Zahlen festgeschrieben/],
    ] as const) {
      const { unmount: leave } = render(panel({ isDrawnSaison: true, spielplanWindow }));

      assert.ok(screen.getByText(note), spielplanWindow);
      leave();
    }
  });
});

/* One German noun phrase per frozen field. A field the write path adds and this table leaves out goes
   unnamed in the panel and fails nothing here. */
const GERMAN_OF: Record<string, string> = {
  number_of_gruppen: "Gruppen",
  teams_per_gruppe: "Teams pro Gruppe",
  qualifiers_per_gruppe: "Qualifikanten",
};

/**
 * Whether one phrase stands in a text as a whole word.
 *
 * German compounds a term into a longer word meaning something else, so „Gruppenphase“ satisfies a
 * substring search for the group COUNT while naming no count at all.
 */
const names = (german: string, text: string): boolean => new RegExp(`(?<!\\p{L})${german}(?!\\p{L})`, "u").test(text);

/** The one frozen field a redraw alone moves, spelled as `GERMAN_OF` is, so the case reads no backend file. */
const REDRAWABLE_SHAPE_FIELD = "qualifiers_per_gruppe";

/** Which of the panel's repairs name one field, by position. */
const repairsNaming = (repairs: readonly string[], field: string): Set<number> =>
  new Set(repairs.flatMap((sentence, index) => (names(GERMAN_OF[field] ?? "", sentence) ? [index] : [])));

/** Every paragraph one state of the panel shows. */
function paragraphsOf(props: Partial<RegelnProps>): string[] {
  const { unmount } = render(panel(props));
  const shown = screen.getAllByRole("paragraph").map((paragraph) => paragraph.textContent);
  unmount();

  return shown;
}

/**
 * The repairs the panel names once the draw has frozen the shape.
 *
 * Read as what the freeze ADDS to the undrawn panel, so neither case below finds the note by the
 * words it is about to assert about it.
 */
function openRepairs(): string[] {
  const standing = new Set(paragraphsOf({}));
  const added = paragraphsOf({ isDrawnSaison: true, spielplanWindow: "open" }).filter((paragraph) => !standing.has(paragraph));

  expect(added.length, "the frozen shape is explained by no paragraph of its own, or by more than one").toBe(1);

  return (added[0] ?? "").split(/(?<=\.)\s+/).filter((sentence) => sentence !== "");
}

describe("the repairs the reloaded panel names for the shape the draw freezes", () => {
  /* The refusal is a bare message sending the admin back to this panel, so a field the panel leaves out of its
     repairs has no route named for it anywhere. */
  it("names a repair for every field the refusal freezes", () => {
    const repairs = openRepairs();

    assert.ok(repairs.length > 1, "the note states one repair, so it parts no field from another");
    for (const [field, german] of Object.entries(GERMAN_OF))
      assert.ok(
        repairs.some((sentence) => names(german, sentence)),
        `the shape refusal freezes ${field} and no repair in the panel names ${german}`,
      );
  });

  /* Two repairs because they are two jobs: raising a pinned field needs clubs entered between an undraw and a
     redraw, which a redraw alone never asks for, so one sentence for all three sends an admin on the wrong job. */
  it("parts the redrawable field from the ones the entries pin", () => {
    const repairs = openRepairs();
    const redrawable = repairsNaming(repairs, REDRAWABLE_SHAPE_FIELD);
    const pinned = Object.keys(GERMAN_OF)
      .filter((field) => field !== REDRAWABLE_SHAPE_FIELD)
      .map((field) => [field, repairsNaming(repairs, field)] as const);

    assert.ok(redrawable.size > 0, `no repair in the panel names ${REDRAWABLE_SHAPE_FIELD}`);
    assert.ok(pinned.length > 0, "every frozen field is the one a redraw moves, so this parts nothing");

    const shared = pinned.map(([, wo]) => wo).reduce((left, right) => new Set([...left].filter((at) => right.has(at))));
    for (const [field, wo] of pinned)
      for (const at of wo)
        assert.ok(!redrawable.has(at), `one repair names ${field} beside ${REDRAWABLE_SHAPE_FIELD}, and a redraw moves only the second`);
    assert.ok(shared.size > 0, "the fields the entries pin take different repairs, where the write path composes them one");
  });
});

describe("the rules panel's shape offer", () => {
  /* `rules_gruppen_in_use` from the season's own clubs: two groups would strand the club entered in C. */
  it("closes the group counts the season's clubs rule out, and holds the team stepper at the fullest group", async () => {
    const user = userEvent.setup();
    const { unmount } = render(panel({ gruppenOccupancy: {} }));
    expect(screen.getByRole("button", { name: "verringern Teams pro Gruppe" }).hasAttribute("disabled")).toBe(false);
    unmount();

    render(panel({ gruppenOccupancy: { A: 4, B: 4, C: 1 } }));
    expect(screen.getByRole("button", { name: "verringern Teams pro Gruppe" }).hasAttribute("disabled")).toBe(true);

    await user.click(trigger(/^Gruppen/));
    expect(screen.getByRole("option", { name: /^2/ }).getAttribute("aria-disabled"), "two groups stay open over a club in C").toBe("true");
  });

  /* A season written by hand can hold a count the offer does not carry; dropped, the save sends a number nobody
     chose. */
  it("keeps a stored count the offer does not carry, and stands on it", () => {
    render(panel({ rules: { ...RULES, number_of_gruppen: 3 } }));

    expect(trigger(/^Gruppen/).textContent).toMatch(/^3/);
  });
});

describe("the season editor's one reading of the season, handed to its panels", () => {
  /* The swap (`swap_saison_started`) and the tiebreak (`rules_saison_started`) close on the season's one served start,
     and the rules panel's window is the undraw's own: a second reading of either drifts from the first and offers
     what the endpoint refuses. */
  it("closes the swap picker and freezes the tiebreak on a started season, and states the window the undraw is closed by", () => {
    render(
      underNext(
        h(AdminSaisonEditView, {
          saison: {
            id: "2026",
            status: "future",
            start_date: "2026-08-01",
            end_date: "2027-06-30",
            rules: RULES,
            bewerbung: null,
            registrierung: null,
          },
          rollover: { outgoingSaisonId: null, offeneSpiele: [], hasUndatierteSpieltage: false, loeschung: null },
          // Two clubs in two groups, so only the start can close the picker.
          swap: {
            teams: [
              { id: "a".repeat(24), name: "SV Alt", gruppe: "A", gruppenSpieleProSpieltag: {}, koSpieleProSpieltag: {} },
              { id: "b".repeat(24), name: "SV Neu", gruppe: "B", gruppenSpieleProSpieltag: {}, koSpieleProSpieltag: {} },
            ],
            hasStarted: true,
          },
          ersatz: { rows: [], candidates: [] },
          spielplan: {
            spielplan: { generated_at: "2026-07-01", spieltage: 5, spiele: 15 },
            spieltageCount: 5,
            schedule: [
              { phase: "gruppenphase", spieltage: 3, matches_per_spieltag: 4 },
              { phase: "halbfinale", spieltage: 1, matches_per_spieltag: 2 },
              { phase: "finale", spieltage: 1, matches_per_spieltag: 1 },
            ],
            bestand: { spiele: 15, erfasst: 2, angesetzt: 4 },
            eingereichteBerichte: 0,
          },
          hasDrawnSpiele: true,
          spieltagBound: { startMax: null, endMin: null },
        }),
        { search: "saison_id=2026" },
      ),
    );

    assert.ok(screen.getByText("Nach dem Beginn der Saison ist ein Gruppentausch nicht mehr möglich"));
    // No picker at all, the callout standing in its place: a picker on a started season offers a press the endpoint 409s.
    expect(screen.queryByText("Tauscht Gruppen mit"), "the swap picker stays open on a started season").toBe(null);
    expect(isClosed(trigger(/Was zuerst entscheidet$/)), "the rules panel reads the start some other way").toBe(true);
    assert.ok(
      screen.getByText(/Solange zu mindestens einem Spiel dieser Saison etwas eingetragen ist/),
      "the rules panel decides the window itself",
    );
  });
});
