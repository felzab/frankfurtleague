import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";
/* The season editor reads `useRouter` and `useSearchParams`, whose contexts no `next/navigation` export carries, so it
   is rendered under the two Next keeps them on. */
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime.js";
import { SearchParamsContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { deriveDraftStatus } from "@/shared/utils/draftStatus.ts";

import type { FLSaisonRules } from "@/features/saisons/schemas.ts";
import type { ContextType } from "react";

const { FormRegelnSection } = await import("./FormRegelnSection.tsx");
const { AdminSaisonEditForm } = await import("./AdminSaisonEditForm.tsx");
const { DraftStatusProvider } = await import("@/shared/components/ui/DraftStatusContext.tsx");

type RegelnProps = Parameters<typeof FormRegelnSection>[0];

/** No descriptor for any path, which is the state the panel stands in until a save judges one. */
const STATUS = deriveDraftStatus<null, string>({ descriptors: [], stored: null, draft: null, fieldErrors: {} });

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

/** A season neither freeze reaches, holding no club, which every case moves one fact away from. */
const PANEL: RegelnProps = {
  rules: RULES,
  onRulesChange: () => undefined,
  onFieldLeft: () => undefined,
  onStufenChange: () => undefined,
  isFinishedSaison: false,
  isKnockoutStarted: false,
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
  /* `REQ-RULES-012` refuses the change outright, and either freeze alone closes the control. A finished season is
     answered by the standing banner the panel carries, so the knockout's sentence is the running season's alone. */
  it("closes the tiebreak on a started knockout or a finished season, and names the knockout's rule only while the season runs", () => {
    for (const [isKnockoutStarted, isFinishedSaison, closed, explained] of [
      [false, false, false, false],
      [true, false, true, true],
      [false, true, true, false],
      [true, true, true, false],
    ] as const) {
      const { unmount } = render(panel({ isKnockoutStarted, isFinishedSaison }));
      const state = `knockout started: ${String(isKnockoutStarted)}, finished: ${String(isFinishedSaison)}`;

      assert.equal(isClosed(trigger(/Was zuerst entscheidet$/)), closed, state);
      assert.equal(screen.queryByText("Nach dem Beginn der KO-Runde lässt sich der Tiebreak nicht mehr ändern.") !== null, explained, state);
      unmount();
    }
  });

  /* The qualifiers alone are in the finished season's freeze: the table is scored from them, and `REQ-RULES-005`
     names no group count. */
  it("closes each shape count where its own freeze reaches it", () => {
    for (const [props, gruppen, qualifikanten] of [
      [{}, false, false],
      [{ isDrawnSaison: true }, true, true],
      [{ isFinishedSaison: true }, false, true],
    ] as const) {
      const { unmount } = render(panel(props));

      assert.equal(isClosed(trigger(/^Gruppen/)), gruppen, JSON.stringify(props));
      assert.equal(isClosed(trigger(/^Qualifikanten pro Gruppe/)), qualifikanten, JSON.stringify(props));
      unmount();
    }
  });

  /* A redraw that moves the groups is out of reach while the draw stands, and nothing returns a season to `future`
     (`docs/backend/spec.md :: I18`), so a repair named outside the window is one nobody can take. */
  it("names the repairs for the frozen shape inside the Spielplan window, and the freeze or its condition outside it", () => {
    const { unmount } = render(panel({}));
    assert.equal(screen.queryByText(/Spielplan/), null, "an undrawn season is told how to unfreeze fields nothing has frozen");
    unmount();

    for (const [spielplanWindow, note] of [
      ["open", /mit der neuen Zahl neu anlegst\. .*nimmst Du den Spielplan zurück/],
      ["recorded", /Solange zu mindestens einem Spiel .* weder neu anlegen noch zurücknehmen/],
      ["closed", /nur, solange die Saison geplant ist\. Damit sind diese drei Zahlen festgeschrieben/],
    ] as const) {
      const { unmount: leave } = render(panel({ isDrawnSaison: true, spielplanWindow }));

      assert.ok(screen.getByText(note), spielplanWindow);
      leave();
    }
  });
});

describe("the rules panel's shape offer", () => {
  /* `REQ-RULES-002` from the season's own clubs: two groups would strand the club entered in C. */
  it("closes the group counts the season's clubs rule out, and holds the team stepper at the fullest group", async () => {
    const user = userEvent.setup();
    const { unmount } = render(panel({ gruppenOccupancy: {} }));
    assert.equal(screen.getByRole("button", { name: "verringern Teams pro Gruppe" }).hasAttribute("disabled"), false);
    unmount();

    render(panel({ gruppenOccupancy: { A: 4, B: 4, C: 1 } }));
    assert.equal(screen.getByRole("button", { name: "verringern Teams pro Gruppe" }).hasAttribute("disabled"), true);

    await user.click(trigger(/^Gruppen/));
    assert.equal(screen.getByRole("option", { name: /^2/ }).getAttribute("aria-disabled"), "true", "two groups stay open over a club in C");
  });

  /* A season stored before these rules can hold a count the offer does not carry; dropped, the save sends a number
     nobody chose. */
  it("keeps a stored count the offer does not carry, and stands on it", () => {
    render(panel({ rules: { ...RULES, number_of_groups: 3 } }));

    assert.match(trigger(/^Gruppen/).textContent, /^3/);
  });
});

const ROUTER: NonNullable<ContextType<typeof AppRouterContext>> = {
  back: () => undefined,
  forward: () => undefined,
  refresh: () => undefined,
  push: () => undefined,
  replace: () => undefined,
  prefetch: () => undefined,
  bfcacheId: "FormRegelnSection",
};

describe("the season editor's one reading of the season, handed to its panels", () => {
  /* The swap (`REQ-SWAP-002`) and the tiebreak (`REQ-RULES-012`) close on one played knockout fixture, and the rules
     panel's window is the undraw's own: a second reading of either drifts from the first and offers what the
     endpoint refuses. */
  it("freezes the tiebreak where the swap closes, and states the window the undraw is closed by", () => {
    render(
      h(AppRouterContext.Provider, {
        value: ROUTER,
        children: h(SearchParamsContext.Provider, {
          value: new URLSearchParams("saison_id=2026"),
          children: h(AdminSaisonEditForm, {
            saison: { id: "2026", status: "future", start_date: "2026-08-01", end_date: "2027-06-30", rules: RULES, bewerbung: null },
            rollover: { outgoingSaisonId: null, offeneSpiele: [] },
            swap: { teams: [], playedKnockoutSpiele: 1 },
            ersatz: { rows: [], candidates: [] },
            spielplan: {
              spielplan: { generiert_am: "2026-07-01", spieltage: 5, spiele: 15 },
              spieltageCount: 5,
              schedule: [
                { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 4 },
                { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
                { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
              ],
              bestand: { spiele: 15, erfasst: 2, angesetzt: 4 },
            },
            hasDrawnSpiele: true,
            spieltagBound: { startMax: null, endMin: null },
            pageHeader: { title: "Saison 2026" },
          }),
        }),
      }),
    );

    assert.ok(screen.getByText("Nach dem Beginn der KO-Runde ist ein Gruppentausch nicht mehr möglich"));
    assert.equal(isClosed(trigger(/Was zuerst entscheidet$/)), true, "the rules panel reads the knockout some other way");
    assert.ok(
      screen.getByText(/Solange zu mindestens einem Spiel dieser Saison etwas eingetragen ist/),
      "the rules panel decides the window itself",
    );
  });
});
