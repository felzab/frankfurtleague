import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { beforeEach, describe, it, mock } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { GRUPPEN_OFF_RULES } from "@/features/saisons/constants.ts";
import { drawnSpieltage } from "@/features/saisons/shapeOffer.ts";
import {
  describeAngesetzteSpiele,
  describeSpielplanPermanenz,
  describeSpielplanUmfang,
  describeSpieltageCount,
} from "@/features/saisons/utils.ts";
import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";
import { doubleActions, doubleToasts } from "@/shared/testing/actionDoubles.ts";
import { closedControl, isInTheFlow } from "@/shared/testing/closedControl.ts";
import { underNext } from "@/shared/testing/nextContexts.ts";
import { pressTwice } from "@/shared/testing/twoPress.ts";

/** A write nobody has answered yet, which is how each action answers unless a case says otherwise. */
const running = (): Promise<never> => new Promise(() => undefined);

const { calls, answerWith } = doubleActions({ modules: ["/src/features/saisons/actions.ts"], answer: running });

/** The payloads one action was sent, in the order the panel sent them. */
const sent = (action: string): unknown[] => calls.filter((call) => call.action === action).map((call) => call.payload);

const { raised } = doubleToasts();

const { FormSpielplanSection } = await import("./FormSpielplanSection.tsx");

type SpielplanProps = Parameters<typeof FormSpielplanSection>[0];

/** A planned season before its first draw: two full groups of four, a bracket, and a span holding its five matchdays. */
const UNDRAWN: SpielplanProps = {
  saisonId: "2026-27",
  saisonStatus: "future",
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
  startDate: "2026-08-01",
  endDate: "2027-06-30",
  spielplan: null,
  spieltageCount: 0,
  schedule: [
    { phase: "gruppenphase", matchdays: 3, matches_per_matchday: 4 },
    { phase: "halbfinale", matchdays: 1, matches_per_matchday: 2 },
    { phase: "finale", matchdays: 1, matches_per_matchday: 1 },
  ],
  gruppenOccupancy: { A: 4, B: 4 },
  bestand: { spiele: 0, erfasst: 0, angesetzt: 0 },
  hasDrawnSpiele: false,
  onBeforeWrite: () => true,
};

/** The same season drawn with nothing entered, where both writes stand open. */
const DRAWN: SpielplanProps = {
  ...UNDRAWN,
  spielplan: { generiert_am: "2026-07-01", spieltage: 5, spiele: 15 },
  spieltageCount: 5,
  bestand: { spiele: 15, erfasst: 0, angesetzt: 4 },
  hasDrawnSpiele: true,
};

/** The shape the redraw case picks: four groups of four, which the four full groups fit. */
const MOVED_SHAPE = { number_of_groups: 4, teams_per_group: 4, qualifiers_per_group: 2 };

const panel = (props: SpielplanProps) => underNext(h(FormSpielplanSection, props));

beforeEach(() => {
  calls.length = 0;
  raised.length = 0;
  answerWith(running);
});

/** The value the armed readout states beside `label`, read off the description list the readout renders as. */
function readout(label: string): string | null {
  const at = screen.getAllByRole("term").findIndex((term) => term.textContent === label);

  return at === -1 ? null : (screen.getAllByRole("definition")[at]?.textContent ?? null);
}

describe("the Spielplan panel's first draw", () => {
  it("arms on the first press, stating no loss, and sends the draw without a shape on the second", async () => {
    const user = userEvent.setup();
    render(panel(UNDRAWN));

    assert.equal(screen.queryAllByRole("radio").length, 0, "a first draw is offered a choice between writes");
    assert.ok(screen.queryByRole("button", { name: /^Gruppen/ }) === null, "a first draw offers numbers it cannot send");

    await pressTwice(user, {
      resting: "Spielplan anlegen",
      armed: "Ja, Spielplan anlegen",
      whileArmed: () => {
        assert.equal(sent("generateSpielplanAction").length, 0, "one press wrote");
        const alert = screen.getByRole("alert");
        assert.doesNotMatch(alert.textContent, /Was dabei gelöscht wird/, "a first draw claims to delete what does not exist");
        assert.ok(alert.textContent.endsWith(describeSpielplanPermanenz({ holdsADraw: false, saisonStatus: "future" })));
      },
    });

    assert.deepEqual(sent("generateSpielplanAction"), [{ id: "2026-27", replace: false, shape: undefined }]);
  });

  /* An open press answers `REQ-SPIELPLAN-004`, which the page has every number for. */
  it("closes over groups the clubs do not fill, and says why in the body as well", () => {
    render(panel({ ...UNDRAWN, gruppenOccupancy: { A: 4, B: 3 } }));

    closedControl("Spielplan anlegen", GRUPPEN_OFF_RULES);
    assert.ok(isInTheFlow(GRUPPEN_OFF_RULES), "the reason is readable only by pointing at the closed press");
  });

  /* A hint and a banner on one panel never carry the same fact (`docs/frontend/spec.md` §1.12). */
  it("leaves a running season's closure to its callout rather than saying it twice", () => {
    render(panel({ ...DRAWN, saisonStatus: "active" }));

    const reason = "Der Spielplan lässt sich für laufende Saisons nicht neu anlegen.";
    closedControl("Spielplan anlegen", reason);
    assert.ok(screen.queryByRole("button", { name: /^Gruppen/ }) === null, "a press no window opens offers numbers it cannot send");
    assert.ok(isInTheFlow("Der Spielplan lässt sich für laufende Saisons nicht neu anlegen"), "the callout stating the rule is gone");
    assert.equal(isInTheFlow(reason), false, "the reason is said a second time beside the callout");
  });
});

describe("the Spielplan panel on a drawn planned season", () => {
  /* Each write destroys the same rows, so a preselection would arm the operation nobody read; a pick lifts
     the closure, so its reason rides the press alone (`docs/frontend/spec.md` §1.14). */
  it("closes the press until the reader picks a write, and says so on the press alone", () => {
    render(panel(DRAWN));

    const prompt = "Wähle „Neu anlegen“ oder „Zurücknehmen“.";
    closedControl("Spielplan neu anlegen", prompt);
    assert.equal(isInTheFlow(prompt), false, "the missing choice is said in the body, which the pick takes it out of");
    assert.deepEqual(
      screen.getAllByRole("radio").map((radio) => [radio.textContent, radio.getAttribute("aria-checked")]),
      [
        ["Neu anlegen", "false"],
        ["Zurücknehmen", "false"],
      ],
    );
  });

  /* The press STORES the numbers, so an admin agreeing to a redraw agrees to the season's new shape. */
  it("sends a replace with the numbers in its boxes, reading the moved one out before the second press", async () => {
    const user = userEvent.setup();
    render(panel({ ...DRAWN, gruppenOccupancy: { A: 4, B: 4, C: 4, D: 4 } }));

    await user.click(screen.getByRole("radio", { name: "Neu anlegen" }));
    await user.click(screen.getByRole("button", { name: /^Gruppen/ }));
    await user.click(screen.getByRole("option", { name: "4" }));

    await pressTwice(user, {
      resting: "Spielplan neu anlegen",
      armed: "Ja, löschen und neu anlegen",
      whileArmed: () => {
        const alert = screen.getByRole("alert").textContent;
        assert.equal(readout("Gruppen"), "von 2 auf 4");
        assert.match(alert, /zusammen mit dem Spielplan gespeichert/);
        // The served scope was derived from the numbers this press replaces, so the fixture count it states describes
        // no season the press writes; the matchdays the sent numbers imply are mirrored and stated.
        assert.equal(readout("Spieltage"), describeSpieltageCount(drawnSpieltage(MOVED_SHAPE)));
        assert.match(alert, /Wie viele Spiele aus den neuen Zahlen entstehen, steht erst nach dem Anlegen fest/);
        // A venue or a referee closes the replace (`holds_a_recorded_fact`), so no armed replace can lose one.
        assert.doesNotMatch(alert, /Schiedsrichter|\bOrte?\b/);
      },
    });

    assert.deepEqual(sent("generateSpielplanAction"), [{ id: "2026-27", replace: true, shape: MOVED_SHAPE }]);
  });

  /* The draw judges occupancy ahead of the bracket where the rules patch judges the other way round, so
     the rules panel's offer would take four groups from eight clubs. */
  it("offers the draw's own counts, and freezes the boxes once armed", async () => {
    const user = userEvent.setup();
    render(panel(DRAWN));
    await user.click(screen.getByRole("radio", { name: "Neu anlegen" }));

    await user.click(screen.getByRole("button", { name: /^Gruppen/ }));
    assert.equal(screen.getByRole("option", { name: /^4/ }).getAttribute("aria-disabled"), "true", "four groups from eight clubs is offered");
    await user.keyboard("{Escape}");
    assert.equal(
      screen.getByRole("button", { name: "verringern Teams pro Gruppe" }).hasAttribute("disabled"),
      true,
      "the team stepper steps below the fullest group",
    );

    await user.click(screen.getByRole("button", { name: "Spielplan neu anlegen" }));
    assert.equal(screen.getByRole("button", { name: /^Gruppen/ }).hasAttribute("disabled"), true, "a box stays live under the armed alert");
    assert.equal(screen.getByRole("textbox", { name: "Teams pro Gruppe" }).hasAttribute("readonly"), true);
  });

  /* The stepper's floor is the fullest group, so it takes five teams per group, which the draw refuses. */
  it("closes a replace over numbers the draw refuses, on the press alone", async () => {
    const user = userEvent.setup();
    render(panel(DRAWN));
    await user.click(screen.getByRole("radio", { name: "Neu anlegen" }));

    // A step from the keyboard: the step button repeats while held, and jsdom never ends that hold.
    await user.click(screen.getByRole("textbox", { name: "Teams pro Gruppe" }));
    await user.keyboard("{ArrowUp}");

    closedControl("Spielplan neu anlegen", GRUPPEN_OFF_RULES);
    assert.equal(isInTheFlow(GRUPPEN_OFF_RULES), false, "a closure the next step lifts is said in the body");
  });

  /* No step in the boxes lifts this closure, so a reader who never points at the control would never learn the
     repair is the team page: a standing condition is said in the body as well (`docs/frontend/spec.md` §1.14). */
  it("says a groups refusal no offered shape lifts in the body as well", async () => {
    const user = userEvent.setup();
    render(panel({ ...DRAWN, gruppenOccupancy: { A: 4, B: 3 } }));
    await user.click(screen.getByRole("radio", { name: "Neu anlegen" }));

    closedControl("Spielplan neu anlegen", GRUPPEN_OFF_RULES);
    assert.ok(isInTheFlow(GRUPPEN_OFF_RULES), "a closure no step lifts is readable only by pointing at the closed press");
  });

  /* The span is weighed against the matchdays the SENT numbers imply, so the stored rules may not withhold it. */
  it("offers a replace whose numbers fit a span the stored rules overrun", async () => {
    const user = userEvent.setup();
    // Four days, where two groups of four with two qualifying imply five matchdays and one qualifying four.
    render(panel({ ...DRAWN, endDate: "2026-08-04" }));
    await user.click(screen.getByRole("radio", { name: "Neu anlegen" }));

    closedControl("Spielplan neu anlegen", /zu kurz/);
    await user.click(screen.getByRole("button", { name: /^Qualifikanten pro Gruppe/ }));
    await user.click(screen.getByRole("option", { name: "1" }));

    await pressTwice(user, { resting: "Spielplan neu anlegen", armed: "Ja, löschen und neu anlegen" });
    assert.deepEqual(sent("generateSpielplanAction"), [
      { id: "2026-27", replace: true, shape: { number_of_groups: 2, teams_per_group: 4, qualifiers_per_group: 1 } },
    ]);
  });

  it("sends the undraw once picked, after reading out what it deletes, and disarms when the pick moves", async () => {
    const user = userEvent.setup();
    // Counts apart from the watermark's, so the rows can only be read off what the season holds now.
    render(panel({ ...DRAWN, spieltageCount: 6, bestand: { spiele: 17, erfasst: 0, angesetzt: 3 } }));

    await user.click(screen.getByRole("radio", { name: "Zurücknehmen" }));
    assert.ok(screen.queryByRole("button", { name: /^Gruppen/ }) === null, "the undraw offers numbers it never sends");
    await user.click(screen.getByRole("button", { name: "Spielplan zurücknehmen" }));

    assert.equal(readout("Bisher angelegt"), describeSpielplanUmfang(6, 17));
    assert.equal(readout("Mit Termin oder Uhrzeit"), describeAngesetzteSpiele(3));
    assert.ok(screen.getByRole("alert").textContent.endsWith(describeSpielplanPermanenz({ holdsADraw: true, saisonStatus: "future" })));

    // The reveal names one write's losses, so a switch under it would have the next press confirm another.
    await user.click(screen.getByRole("radio", { name: "Neu anlegen" }));
    assert.ok(screen.queryByRole("alert") === null, "a switch leaves the previous write armed");
    await user.click(screen.getByRole("radio", { name: "Zurücknehmen" }));

    await pressTwice(user, { resting: "Spielplan zurücknehmen", armed: "Ja, Spielplan zurücknehmen" });
    assert.deepEqual(sent("undrawSpielplanAction"), [{ id: "2026-27" }]);
  });

  /* A second DELETE during the first would report a season that held nothing. A write in flight ends by
     itself, so a season moving under it closes nothing on its press and renames nothing either. */
  it("holds its running press, which names the write it sent and no refusal while the season moves under it", async () => {
    const user = userEvent.setup();
    const { rerender } = render(panel(DRAWN));
    await user.click(screen.getByRole("radio", { name: "Zurücknehmen" }));
    await pressTwice(user, { resting: "Spielplan zurücknehmen", armed: "Ja, Spielplan zurücknehmen" });

    rerender(panel({ ...DRAWN, bestand: { spiele: 15, erfasst: 2, angesetzt: 4 } }));
    assert.equal(screen.queryAllByRole("button", { description: /./ }).length, 0, "the running press is covered by a refusal");
    // Something entered makes the draw the operation on offer; the write running is still the undraw.
    const held = screen.getByRole("button", { name: "Nimmt zurück..." });
    assert.equal(held.getAttribute("data-pending"), "true");

    mock.timers.enable({ apis: ["Date"] });
    try {
      mock.timers.tick(DOUBLE_PRESS_MS * 2);
      await user.click(held);
    } finally {
      mock.timers.reset();
    }
    assert.equal(sent("undrawSpielplanAction").length, 1, "a press during the request sends the write again");
  });

  /* „zurückgenommen“ over a season that held nothing claims work nobody did; the watermark alone is work. */
  it("reports an undraw that removed nothing as information, and one that cleared the watermark as done", async () => {
    for (const [watermark_cleared, variant, title] of [
      [false, "info", "Kein Spielplan vorhanden"],
      [true, "success", "Spielplan zurückgenommen"],
    ] as const) {
      answerWith(() => Promise.resolve({ success: true, message: "", undraw: { spieltage: 0, spiele: 0, watermark_cleared } }));
      const user = userEvent.setup();
      const { unmount } = render(panel(DRAWN));
      await user.click(screen.getByRole("radio", { name: "Zurücknehmen" }));
      await pressTwice(user, { resting: "Spielplan zurücknehmen", armed: "Ja, Spielplan zurücknehmen" });

      assert.deepEqual(
        raised.map((toast) => [toast.variant, toast.title, toast.description]),
        [[variant, title, ""]],
      );
      raised.length = 0;
      unmount();
    }
  });
});
