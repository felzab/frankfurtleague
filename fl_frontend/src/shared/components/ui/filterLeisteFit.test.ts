import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fitOverflow, isNarrowRow, NARROW_ROW } from "./filterLeisteFit";

import type { FitInput } from "./filterLeisteFit";

// Four candidates of 100px each, an overflow control that costs 60px per named dimension and a flat
// 90px when it counts them instead. `gap` is `gap-2`.
const BASE: FitInput = {
  available: 1000,
  candidates: [100, 100, 100, 100],
  namesWidths: [60, 120, 180, 240],
  countWidths: [90, 90, 90, 90],
  gap: 8,
};

describe("fitOverflow", () => {
  it("takes every candidate when they all fit, and asks for no overflow control", () => {
    const fit = fitOverflow(BASE);

    // 4 x (100 + 8) = 432 against 1000.
    assert.deepEqual(fit, { pulled: 4, namesFit: true });
  });

  it("spends nothing on an overflow control in that case", () => {
    // 432 exactly, with no room for a label of any width — the control is not there to pay for.
    const fit = fitOverflow({ ...BASE, available: 432 });

    assert.deepEqual(fit, { pulled: 4, namesFit: true });
  });

  it("drops the last candidate first, so the row keeps its order", () => {
    // 3 pulled = 324, plus the gap before the control = 332; 60px of names needs 392.
    const fit = fitOverflow({ ...BASE, available: 400 });

    assert.deepEqual(fit, { pulled: 3, namesFit: true });
  });

  it("counts the overflowed dimensions when naming them does not fit but counting them does", () => {
    // 2 pulled = 216 + 8 = 224. Naming two costs 120 (needs 344); counting them costs 90 (needs 314).
    const fit = fitOverflow({ ...BASE, available: 320 });

    assert.deepEqual(fit, { pulled: 2, namesFit: false });
  });

  it("names a single overflowed dimension as soon as the row has room for its name", () => {
    // 3 pulled = 324, leaving 98 after the gap; naming one costs 60.
    const fit = fitOverflow({ ...BASE, available: 430 });

    assert.deepEqual(fit, { pulled: 3, namesFit: true });
  });

  it("prefers one MORE dimension inline over naming the ones behind the control", () => {
    // At 430 the choice is "3 inline + 1 counted" (needs 412) against "2 inline + 2 named" (needs 374).
    // Both fit; the row shows three, because a dimension in the row beats its name on a label.
    const fit = fitOverflow({ ...BASE, available: 430, namesWidths: [150, 150, 150, 150], countWidths: [80, 80, 80, 80] });

    assert.deepEqual(fit, { pulled: 3, namesFit: false });
  });

  it("falls back to everything overflowed and counted when nothing else fits", () => {
    const fit = fitOverflow({ ...BASE, available: 10 });

    assert.deepEqual(fit, { pulled: 0, namesFit: false });
  });

  it("asks for no control at all when there are no candidates", () => {
    // The five surfaces carrying three facets or fewer, which declare no promotion and therefore
    // promote everything.
    const fit = fitOverflow({ ...BASE, candidates: [], namesWidths: [], countWidths: [] });

    assert.deepEqual(fit, { pulled: 0, namesFit: true });
  });

  it("survives a negative budget rather than pulling a candidate into it", () => {
    // A promoted set wider than the row leaves nothing to fit into; the row scrolls sideways instead.
    const fit = fitOverflow({ ...BASE, available: -50 });

    assert.deepEqual(fit, { pulled: 0, namesFit: false });
  });

  it("never claims a label form whose width was not supplied", () => {
    // A short measurement must not read as "it fits" — the missing entry is treated as infinite.
    const fit = fitOverflow({ ...BASE, available: 400, namesWidths: [], countWidths: [] });

    assert.deepEqual(fit, { pulled: 0, namesFit: false });
  });
});

describe("isNarrowRow", () => {
  it("calls a phone's row narrow and a tablet's wide", () => {
    // A 375px viewport leaves 343 after the page's own inset; the narrowest tablet layout leaves 704.
    assert.equal(isNarrowRow(343), true);
    assert.equal(isNarrowRow(704), false);
  });

  it("puts the boundary itself on the wide side", () => {
    assert.equal(isNarrowRow(NARROW_ROW), false);
    assert.equal(isNarrowRow(NARROW_ROW - 1), true);
  });
});
