import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rolloverBlockedReason, spielplanBlockedReason, spielplanReplacesDraw } from "./blockedReasons.ts";

import type { SpielplanControlInput } from "./blockedReasons.ts";

const spielplanInput = (overrides: Partial<SpielplanControlInput> = {}): SpielplanControlInput => ({
  saisonStatus: "future",
  hasSpielplan: false,
  hasDrawnSpiele: false,
  spieltageCount: 0,
  erfassteSpieleCount: 0,
  hasKoRunden: true,
  ...overrides,
});

const spielplanBlock = (overrides: Partial<SpielplanControlInput> = {}): string | null => spielplanBlockedReason(spielplanInput(overrides));

const replacesDraw = (overrides: Partial<SpielplanControlInput> = {}): boolean => spielplanReplacesDraw(spielplanInput(overrides));

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

  /* `REQ-SPIELPLAN-001` and `REQ-SPIELPLAN-002` step aside for a confirmed replace, and this page
     confirms one wherever there is something to destroy. Each state below therefore OFFERS the
     control on a planned season with nothing entered. */
  it("offers a replace on each state that holds something to destroy", () => {
    for (const held of [{ hasSpielplan: true }, { hasDrawnSpiele: true }, { spieltageCount: 1 }]) {
      assert.equal(spielplanBlock(held), null, `${JSON.stringify(held)} still closes the control`);
      assert.equal(replacesDraw(held), true, `${JSON.stringify(held)} offers a first draw rather than a replace`);
    }
  });

  /* Both halves of `REQ-SPIELPLAN-005` under one condition, as the endpoint has one code for them.
     Each sentence names only the half that closed the window, neither promising a repair. */
  it("closes the replace outside its window, and says which half closed it", () => {
    assert.match(spielplanBlock({ ...DRAWN, saisonStatus: "active" }) ?? "", /solange die Saison geplant ist/);

    const erfasst = spielplanBlock({ ...DRAWN, erfassteSpieleCount: 1 }) ?? "";
    assert.match(erfasst, /schon etwas eingetragen/);
    // Every category `holds_a_recorded_fact` counts, the note included. Drop one and an admin whose
    // season is closed by a cancellation, a booking or a note goes looking for a result that is not there.
    for (const kind of [/Ergebnis/, /Ausfall/, /Ort/, /Schiedsrichter/, /Notiz/]) assert.match(erfasst, kind);
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
      { ...DRAWN, hasKoRunden: false },
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

  /* `find_spielplan_refusal` judges `REQ-SPIELPLAN-005` ahead of `REQ-SPIELPLAN-003`, so a drawn
     `past` season reads the whole replace window rather than the status half of it. The watermark
     closes no control on its own. */
  it("names the replace window first where a drawn season is also finished", () => {
    const reason = spielplanBlock({ ...DRAWN, saisonStatus: "past", spieltageCount: 4 });

    assert.match(reason ?? "", /solange die Saison geplant ist/);
    assert.doesNotMatch(reason ?? "", /abgeschlossen/);
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
