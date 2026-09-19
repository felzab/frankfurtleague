import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GRUPPEN_OFF_RULES } from "@/features/saisons/constants.ts";

import {
  rolloverBlockedReason,
  spielplanBlockedReason,
  spielplanPress,
  spielplanReplacesDraw,
  spielplanShapeBlockedReason,
  spielplanUndrawBlockedReason,
} from "./blockedReasons.ts";

import type { FLSpielplanShape } from "@/features/saisons/schemas.ts";
import type { SpielplanControlInput, SpielplanOperation } from "./blockedReasons.ts";

const spielplanInput = (overrides: Partial<SpielplanControlInput> = {}): SpielplanControlInput => ({
  saisonStatus: "future",
  hasSpielplan: false,
  hasDrawnSpiele: false,
  spieltageCount: 0,
  erfassteSpieleCount: 0,
  hasKoRunden: true,
  startDate: "2026-05-01",
  endDate: "2026-07-31",
  vorschauSpieltage: 8,
  // Two full groups of four, which is what the draw asks of these numbers, so no case below is closed by
  // the groups unless it moves them.
  gruppen: { groups: 2, teams: 4, occupancy: { A: 4, B: 4 } },
  ...overrides,
});

const spielplanBlock = (overrides: Partial<SpielplanControlInput> = {}): string | null => spielplanBlockedReason(spielplanInput(overrides));

const replacesDraw = (overrides: Partial<SpielplanControlInput> = {}): boolean => spielplanReplacesDraw(spielplanInput(overrides));

const undrawBlock = (overrides: Partial<SpielplanControlInput> = {}): string | null => spielplanUndrawBlockedReason(spielplanInput(overrides));

/** A season holding a whole draw and nothing played — the state the replace window is open on. */
const DRAWN: Partial<SpielplanControlInput> = { hasSpielplan: true, hasDrawnSpiele: true, spieltageCount: 8 };

const rolloverBlock = (overrides: Partial<Parameters<typeof rolloverBlockedReason>[0]> = {}): string | null =>
  rolloverBlockedReason({ hasDrawnSpiele: true, outgoingSaisonId: null, offeneSpieleCount: 0, ...overrides });

describe("spielplanBlockedReason", () => {
  it("offers the draw for an empty planned season", () => {
    assert.equal(spielplanBlock(), null);
  });

  /* `REQ-SPIELPLAN-003` refuses `past` alone, so a running season is drawable and the panel has to
     offer it: activation is one-way, and one activated undrawn has no other way out. */
  it("offers the draw for a running season, which only `past` closes", () => {
    assert.equal(spielplanBlock({ saisonStatus: "active" }), null);

    const finished = spielplanBlock({ saisonStatus: "past" });
    assert.match(finished ?? "", /abgeschlossen/);
    // The wording too: naming `geplant` or a running season would state a requirement the endpoint does not have.
    assert.doesNotMatch(finished ?? "", /geplant|läuft schon/);
  });

  /* Both codes step aside for a confirmed replace (`blockedReasons.ts :: spielplanBlockedReason`),
     which this page confirms wherever there is something to destroy. */
  it("offers a replace on each state that holds something to destroy", () => {
    for (const held of [{ hasSpielplan: true }, { hasDrawnSpiele: true }, { spieltageCount: 1 }]) {
      assert.equal(spielplanBlock(held), null, `${JSON.stringify(held)} still closes the control`);
      assert.equal(replacesDraw(held), true, `${JSON.stringify(held)} offers a first draw rather than a replace`);
    }
  });

  /* Both halves of `REQ-SPIELPLAN-005` under one condition, as the endpoint has one code for them.
     Each sentence names the half that closed the window, and the record half names its way back. */
  it("closes the replace outside its window, and says which half closed it", () => {
    // Given copy rather than a sentence derived from the rules: the status half states the rule and
    // names no way back, there being none. Re-derive it and this fails.
    assert.match(spielplanBlock({ ...DRAWN, saisonStatus: "active" }) ?? "", /für laufende Saisons nicht neu anlegen/);

    const erfasst = spielplanBlock({ ...DRAWN, erfassteSpieleCount: 1 }) ?? "";
    assert.match(erfasst, /schon etwas eingetragen/);
    // The verb tells the two panels' record sentences apart; a copy of the undraw's would confirm
    // the wrong operation.
    assert.match(erfasst, /Neu anlegen lässt sich der Spielplan/);
    // Every category `holds_a_recorded_fact` counts. Drop one and an admin whose season is closed by
    // a cancellation, a booking, a note or a hand-seeded slot hunts for a result that is not there.
    for (const kind of [/Ergebnis/, /Ausfall/, /Ort/, /Schiedsrichter/, /Notiz/, /Herkunft/]) assert.match(erfasst, kind);
  });

  /* A running season may still be drawn a FIRST time (`REQ-SPIELPLAN-003` refuses `past` alone), so
     the window may only be read where the press would actually replace something. */
  it("leaves an undrawn running season its first draw, which the replace window would refuse", () => {
    assert.equal(spielplanBlock({ saisonStatus: "active" }), null);
    assert.equal(replacesDraw({ saisonStatus: "active" }), false);
  });

  /* The flag decides the request body, so it may never be `true` where the reason function has
     closed the control: that combination confirms a destruction the endpoint answers with a 409. */
  it("never confirms a replace while the control is closed", () => {
    for (const closed of [
      { ...DRAWN, saisonStatus: "past" as const },
      { ...DRAWN, erfassteSpieleCount: 2 },
    ]) {
      assert.notEqual(spielplanBlock(closed), null, `${JSON.stringify(closed)} is expected to be closed`);
      assert.equal(replacesDraw(closed), false);
    }
  });

  /* `REQ-RULES-001` reaches the draw on its `stored=None` path, where it reduces to a qualifier
     product no bracket has a shape for. It closes the control rather than warning beside a live
     press, which would offer what the write path refuses. */
  it("closes the draw where the rules reach no knockout round, and names the repair", () => {
    const reason = spielplanBlock({ hasKoRunden: false });

    assert.match(reason ?? "", /keine KO-Runde/);
    assert.match(reason ?? "", /Abschnitt Regeln/);
  });

  it("names a spielplan condition ahead of the rules fault, as the endpoint runs its two passes", () => {
    assert.match(spielplanBlock({ ...DRAWN, hasKoRunden: false, erfassteSpieleCount: 1 }) ?? "", /schon etwas eingetragen/);
  });

  /* `REQ-DATE-005` mirrored as a date subtraction against the served schedule's own sum: the season
     read carries the span and the schedule together, so no scheduling rule is recomputed here. */
  it("closes the draw where the span cannot hold the schedule, and names the repair", () => {
    const reason = spielplanBlock({ startDate: "2026-05-01", endDate: "2026-05-07", vorschauSpieltage: 8 });

    assert.match(reason ?? "", /zu kurz/);
    assert.match(reason ?? "", /Abschnitt Zeitraum/);
  });

  /* Inclusive as `find_saison_span_refusal` counts: a season running one day offers one. Count
     exclusively and this mirror refuses a season whose draw the endpoint writes. */
  it("counts the offered days inclusively, as the endpoint does", () => {
    assert.equal(spielplanBlock({ startDate: "2026-05-01", endDate: "2026-05-08", vorschauSpieltage: 8 }), null);
    assert.notEqual(spielplanBlock({ startDate: "2026-05-02", endDate: "2026-05-08", vorschauSpieltage: 8 }), null);
  });

  it("names the rules fault ahead of the span, as the endpoint orders its passes", () => {
    assert.match(spielplanBlock({ hasKoRunden: false, endDate: "2026-05-01" }) ?? "", /keine KO-Runde/);
  });

  /* The one place this mirror parts from `find_spielplan_refusal`, which judges `REQ-SPIELPLAN-005`
     ahead of `REQ-SPIELPLAN-003`: neither closure has a way out, so a finished season reads the state
     it stands in whether or not it holds a draw. */
  it("names the finished season's own freeze where a drawn season is also finished", () => {
    const reason = spielplanBlock({ ...DRAWN, saisonStatus: "past", spieltageCount: 4 });

    assert.match(reason ?? "", /abgeschlossen/);
    // Never the running season's sentence, which is about a state this reader is not in.
    assert.doesNotMatch(reason ?? "", /laufende Saisons/);
  });

  /* Undrawn, so there is nothing for the window to bound — `REQ-SPIELPLAN-003` is what answers, and
     its wording may not survive as dead text behind the window. */
  it("keeps the finished-season freeze reachable on a season holding nothing", () => {
    assert.match(spielplanBlock({ saisonStatus: "past" }) ?? "", /abgeschlossen/);
  });

  /* The window is `REQ-SPIELPLAN-005`'s two figures and nothing else. Widen either half and the
     panel arms a destruction the endpoint answers with a 409, over a season whose numbers the same
     press would have moved. */
  it("opens the replace on a planned season with nothing recorded, and on nothing else", () => {
    assert.equal(spielplanBlock(DRAWN), null);

    assert.notEqual(spielplanBlock({ ...DRAWN, erfassteSpieleCount: 1 }), null);
    assert.notEqual(spielplanBlock({ ...DRAWN, saisonStatus: "active" }), null);
    assert.notEqual(spielplanBlock({ ...DRAWN, saisonStatus: "past" }), null);
  });
});

/** Four groups of four asked for, holding 4, 3, 2 and 1 clubs. */
const SCHIEF = { groups: 4, teams: 4, occupancy: { A: 4, B: 3, C: 2, D: 1 } } as const;

describe("the draw over the groups the season's clubs stand in", () => {
  /* The press would answer `REQ-SPIELPLAN-004`, so the control says so first rather than offering a
     draw the page already knows the endpoint refuses. The draw's mapper returns the same declaration
     (`fl_frontend/src/features/saisons/actions.test.ts`). */
  it("closes a first draw whose groups are off the rules, in the words the refused press is given", () => {
    assert.equal(spielplanBlock({ gruppen: SCHIEF }), GRUPPEN_OFF_RULES);
  });

  /* `find_spielplan_refusal` judges the finished season and the window before the groups, and the
     rules and the span run after the whole pass. */
  it("stands where the endpoint judges it, after the season's state and before the rules and the span", () => {
    assert.match(spielplanBlock({ saisonStatus: "past", gruppen: SCHIEF }) ?? "", /abgeschlossen/);
    assert.match(spielplanBlock({ gruppen: SCHIEF, hasKoRunden: false }) ?? "", /genau so viele Teams/);
    assert.match(spielplanBlock({ gruppen: SCHIEF, endDate: "2026-05-01" }) ?? "", /genau so viele Teams/);
  });

  /* A replace draws from the numbers in the panel's boxes, so the stored ones may not close it: the
     boxes that repair the draft would go with the operation. */
  it("leaves a replace on offer whatever the stored numbers say", () => {
    for (const stored of [{ gruppen: SCHIEF }, { hasKoRunden: false }, { endDate: "2026-05-02" }]) {
      assert.equal(spielplanBlock({ ...DRAWN, ...stored }), null, `${JSON.stringify(stored)} closes the replace over the stored rules`);
      assert.equal(replacesDraw({ ...DRAWN, ...stored }), true);
    }
  });
});

/** Two full groups of four, which is where the stored season stands before a box moves. */
const VOLL = { A: 4, B: 4 };

const shapeBlock = (shape: Partial<FLSpielplanShape> = {}, occupancy: Record<string, number> = VOLL, endDate = "2026-07-31"): string | null =>
  spielplanShapeBlockedReason({
    shape: { number_of_groups: 2, teams_per_group: 4, qualifiers_per_group: 2, ...shape },
    occupancy,
    startDate: "2026-05-01",
    endDate,
  });

describe("spielplanShapeBlockedReason", () => {
  it("offers the numbers the entries fit, whose bracket and matchdays the season holds", () => {
    assert.equal(shapeBlock(), null);
  });

  /* The stepper's floor is the fullest group, so a count above every group is a number the box takes. */
  it("refuses a team count the groups do not hold exactly, in the words the refused press is given", () => {
    assert.equal(shapeBlock({ teams_per_group: 5 }), GRUPPEN_OFF_RULES);
    assert.equal(shapeBlock({ number_of_groups: 1 }), GRUPPEN_OFF_RULES, "a club outside the offered groups is drawn");
  });

  /* `REQ-RULES-001` on the numbers the press carries, too large and shapeless alike. */
  it("refuses a product with no bracket, and names the two boxes that make it", () => {
    // Sixteen groups of two, which the entries fit, so the bracket of 32 is the one fact that refuses.
    const sechzehn = Object.fromEntries([..."ABCDEFGHIJKLMNOP"].map((gruppe) => [gruppe, 2]));

    for (const [shape, occupancy] of [
      [{ qualifiers_per_group: 3 }, VOLL],
      [{ number_of_groups: 16, teams_per_group: 2, qualifiers_per_group: 2 }, sechzehn],
    ] as const) {
      const reason = shapeBlock(shape, occupancy);
      assert.match(reason ?? "", /keine KO-Runde/, `${JSON.stringify(shape)} is offered`);
      assert.match(reason ?? "", /Gruppen oder die Qualifikanten pro Gruppe/);
    }
  });

  /* Four days, and two groups of four with one qualifying imply four matchdays: three rounds and a final. */
  it("weighs the span against the matchdays the sent numbers imply, counting both ends", () => {
    assert.equal(shapeBlock({ qualifiers_per_group: 1 }, VOLL, "2026-05-04"), null);
    assert.match(shapeBlock({}, VOLL, "2026-05-04") ?? "", /zu kurz für die Spieltage, die sich aus diesen Zahlen ergeben/);
    assert.match(shapeBlock({ qualifiers_per_group: 1 }, VOLL, "2026-05-03") ?? "", /Abschnitt Zeitraum/);
  });

  /* The endpoint's order: `find_spielplan_refusal`, then `find_rules_refusal`, then the span. */
  it("names the groups ahead of the bracket, and the bracket ahead of the span", () => {
    assert.equal(shapeBlock({ teams_per_group: 5, qualifiers_per_group: 3 }, VOLL, "2026-05-01"), GRUPPEN_OFF_RULES);
    assert.match(shapeBlock({ qualifiers_per_group: 3 }, VOLL, "2026-05-01") ?? "", /keine KO-Runde/);
  });
});

describe("spielplanPress", () => {
  const STORED_SHAPE: FLSpielplanShape = { number_of_groups: 2, teams_per_group: 4, qualifiers_per_group: 2 };
  const press = (overrides: Partial<SpielplanControlInput>, picked: SpielplanOperation | null = null, shape = STORED_SHAPE) =>
    spielplanPress({ input: spielplanInput(overrides), picked, shape });

  /* Each write destroys the same rows, so the press waits on the reader's choice rather than defaulting to one. */
  it("closes the press on the missing choice alone while both writes stand open", () => {
    assert.deepEqual(press(DRAWN), {
      bothOpen: true,
      operation: "anlegen",
      isUnchosen: true,
      standingReason: null,
      closedReason: "Wähle „Neu anlegen“ oder „Zurücknehmen“.",
    });
  });

  it("makes the pick the operation where both stand open, and the draw everywhere else", () => {
    assert.equal(press(DRAWN, "zuruecknehmen").operation, "zuruecknehmen");
    // Something entered closes both, so a pick left standing may not turn the press into an undraw.
    assert.equal(press({ ...DRAWN, erfassteSpieleCount: 1 }, "zuruecknehmen").operation, "anlegen");
  });

  it("closes a closed panel on the draw's own reason", () => {
    const closed = press({ ...DRAWN, erfassteSpieleCount: 1 });

    assert.equal(closed.standingReason, spielplanBlock({ ...DRAWN, erfassteSpieleCount: 1 }));
    assert.equal(closed.closedReason, closed.standingReason);
  });

  /* The boxes are the replace's payload and nothing else's: a first draw sends the stored rules, and the undraw sends none. */
  it("judges the boxes on the replace's press alone", () => {
    const refused: FLSpielplanShape = { ...STORED_SHAPE, teams_per_group: 5 };

    assert.equal(press(DRAWN, "anlegen", refused).closedReason, GRUPPEN_OFF_RULES);
    assert.equal(press(DRAWN, "anlegen", refused).standingReason, null, "a closure the next step lifts is a standing one");
    assert.equal(press(DRAWN, "zuruecknehmen", refused).closedReason, null);
    assert.equal(press({}, null, refused).closedReason, null);
  });
});

describe("spielplanUndrawBlockedReason", () => {
  /* The endpoint has no refusal for this state, so nothing but the panel closes the press. */
  it("closes the control on a season with nothing drawn to take back", () => {
    const empty = undrawBlock() ?? "";

    assert.match(empty, /keinen Spielplan/);
    // Never the window's wording: nothing is wrong with the season, there is simply nothing to remove.
    assert.doesNotMatch(empty, /geplant ist|eingetragen/);
  });

  /* Each of the three states a draw leaves behind offers the undraw on a planned season with nothing
     entered, exactly as the replace is offered on them. */
  it("offers the undraw on each state that holds something to remove", () => {
    for (const held of [{ hasSpielplan: true }, { hasDrawnSpiele: true }, { spieltageCount: 1 }]) {
      assert.equal(undrawBlock(held), null, `${JSON.stringify(held)} still closes the control`);
    }
  });

  /* Both halves of `REQ-SPIELPLAN-006` under one condition, as the endpoint has one code for them.
     Each sentence names the half that closed the window, and the record half names its way back. */
  it("closes the undraw outside its window, and says which half closed it", () => {
    for (const status of ["active", "past"] as const) {
      assert.match(undrawBlock({ ...DRAWN, saisonStatus: status }) ?? "", /solange die Saison geplant ist/);
    }

    const erfasst = undrawBlock({ ...DRAWN, erfassteSpieleCount: 1 }) ?? "";
    assert.match(erfasst, /schon etwas eingetragen/);
    // This panel's verb, as the replace's arm pins its own: one sentence copied across would offer
    // the operation the admin is not standing in front of.
    assert.match(erfasst, /Zurücknehmen lässt sich der Spielplan/);
  });

  /* A date alone is not a recorded fact, and `buildSpielplanBestand` counts it under `angesetzt`
     instead. Close on it here and a fully dated but unplayed season could never be redrawn. */
  it("leaves the undraw open on a season whose fixtures only carry dates", () => {
    assert.equal(undrawBlock({ ...DRAWN, erfassteSpieleCount: 0 }), null);
  });

  /* The knockout list and the span decide what a DRAW would write and nothing about a removal. Read
     either here and a season whose rules or dates went wrong could never be taken back and repaired. */
  it("ignores the schedule the draw is judged on", () => {
    assert.equal(undrawBlock({ ...DRAWN, hasKoRunden: false }), null);
    assert.equal(undrawBlock({ ...DRAWN, endDate: "2026-05-01" }), null);
  });

  /* `FormSpielplanSection` names the draw wherever one act alone stands on offer, so an undraw offered without the
     draw beside it would present a closed draw over a season the undraw can empty. */
  it("never offers the undraw where the draw is closed", () => {
    let offered = 0;

    for (const saisonStatus of ["future", "active", "past"] as const)
      for (const held of [{}, DRAWN, { hasSpielplan: true }, { hasDrawnSpiele: true }, { spieltageCount: 1 }])
        for (const erfassteSpieleCount of [0, 1])
          for (const hasKoRunden of [true, false])
            for (const endDate of ["2026-07-31", "2026-05-01"]) {
              const state = { ...held, saisonStatus, erfassteSpieleCount, hasKoRunden, endDate };
              if (undrawBlock(state) !== null) continue;

              offered += 1;
              assert.equal(spielplanBlock(state), null, `${JSON.stringify(state)} offers the undraw alone`);
            }

    // A floor, so a grid that stopped reaching an open undraw cannot pass by comparing nothing.
    assert.ok(offered >= 4, `the grid reaches ${String(offered)} states offering the undraw`);
  });
});

/* The two windows are one rule, so their sentences are asked the same question here rather than
   twice above: what an admin standing in front of each half is told about leaving it. */
describe("what each half of the window promises", () => {
  const halves = [
    { operation: "replace", block: spielplanBlock },
    { operation: "undraw", block: undrawBlock },
  ] as const;

  for (const { operation, block } of halves) {
    it(`gives the record half a way back and the status half none, on the ${operation}`, () => {
      const record = block({ ...DRAWN, erfassteSpieleCount: 1 }) ?? "";

      // `PATCH /spiele/{spiel_id}` rewrites every field `holds_a_recorded_fact` reads, so clearing
      // what was entered reopens this half and the sentence may say so.
      assert.match(record, /erst wieder/);
      // The defect this is against: worded as a closed door, a season one fixture edit away from a
      // redraw reads as finished, and the admin stops rather than going to the fixture.
      assert.doesNotMatch(record, /nicht mehr/);

      // Nothing writes `status` back to `future` (`docs/backend/spec.md :: I18`), so the same phrase
      // here would send an admin after a route the product does not have.
      assert.doesNotMatch(block({ ...DRAWN, saisonStatus: "active" }) ?? "", /erst wieder/);
    });
  }
});

describe("rolloverBlockedReason", () => {
  it("offers the first rollover of a fresh database, where no incumbent can be unfinished", () => {
    assert.equal(rolloverBlock(), null);
  });

  /* `REQ-ACTIVATE-003`: a season with nothing drawn would go live with nothing to play, and the
     draw is the remedy the message has to name. */
  it("closes the rollover on an undrawn season and points at the draw", () => {
    const reason = rolloverBlock({ hasDrawnSpiele: false });

    assert.match(reason ?? "", /Spielplan/);
    assert.match(reason ?? "", /Abschnitt Spielplan/);
  });

  it("closes the rollover while the incumbent still owes results", () => {
    assert.match(rolloverBlock({ outgoingSaisonId: "2025", offeneSpieleCount: 3 }) ?? "", /keine offenen Spiele mehr/);
    // The incumbent alone decides nothing: its fixtures are only a blocker while one exists.
    assert.equal(rolloverBlock({ outgoingSaisonId: "2025", offeneSpieleCount: 0 }), null);
    assert.equal(rolloverBlock({ outgoingSaisonId: null, offeneSpieleCount: 3 }), null);
  });

  it("names the undrawn season before the incumbent, as the endpoint orders them", () => {
    const both = rolloverBlock({ hasDrawnSpiele: false, outgoingSaisonId: "2025", offeneSpieleCount: 3 });

    assert.match(both ?? "", /Spielplan/);
    assert.doesNotMatch(both ?? "", /laufende Saison keine offenen/);
  });
});
