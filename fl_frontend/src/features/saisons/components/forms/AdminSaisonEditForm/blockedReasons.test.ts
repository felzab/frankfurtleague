import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { rolloverBlockedReason, spielplanBlockedReason } from "./blockedReasons.ts";

const spielplanBlock = (overrides: Partial<Parameters<typeof spielplanBlockedReason>[0]> = {}): string | null =>
  spielplanBlockedReason({
    saisonStatus: "future",
    hasSpielplan: false,
    hasDrawnSpiele: false,
    spieltageCount: 0,
    hasKoRunden: true,
    ...overrides,
  });

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

  it("closes the draw on the endpoint's remaining spielplan conditions", () => {
    assert.match(spielplanBlock({ hasSpielplan: true }) ?? "", /wurde schon angelegt/);
    assert.match(spielplanBlock({ hasDrawnSpiele: true }) ?? "", /schon Spiele angelegt/);
    assert.match(spielplanBlock({ spieltageCount: 1 }) ?? "", /schon Spieltage/);
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
    assert.match(spielplanBlock({ hasKoRunden: false, spieltageCount: 1 }) ?? "", /schon Spieltage/);
  });

  it("names the watermark first where a drawn season is also finished", () => {
    assert.match(spielplanBlock({ hasSpielplan: true, saisonStatus: "past", spieltageCount: 4 }) ?? "", /Er entsteht genau einmal/);
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
