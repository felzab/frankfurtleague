import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { balanceLastLine, packLines } from "./filterPanelLines";

// The public Spielsuche's four facets as measured in the running app at 1440: Status, Phase, Team, Ort.
const PUBLIC_FOUR = [179, 202, 329, 288];
const GAP = 12;

describe("packLines", () => {
  it("keeps everything on one line while it fits", () => {
    // 179 + 12 + 202 + 12 + 329 + 12 + 288 = 1034.
    assert.deepEqual(packLines(PUBLIC_FOUR, 1034, GAP), [[0, 1, 2, 3]]);
  });

  it("drops the cell that no longer fits onto the next line", () => {
    // One pixel short of the whole row, which is the 1440 panel's own 1025 in miniature.
    assert.deepEqual(packLines(PUBLIC_FOUR, 1033, GAP), [[0, 1, 2], [3]]);
  });

  it("gives a cell wider than the line a line of its own", () => {
    assert.deepEqual(packLines([400, 100], 300, GAP), [[0], [1]]);
  });

  it("returns nothing for no cells", () => {
    assert.deepEqual(packLines([], 1000, GAP), []);
  });
});

describe("balanceLastLine", () => {
  it("moves one cell down rather than leaving it alone", () => {
    // 1440: four naturals need 1034 of a 1025 line, so the flex row packs three and one.
    assert.deepEqual(packLines(PUBLIC_FOUR, 1025, GAP), [[0, 1, 2], [3]]);
    assert.deepEqual(balanceLastLine(PUBLIC_FOUR, 1025, GAP), [
      [0, 1],
      [2, 3],
    ]);
  });

  it("does the same at the narrower panel, where the packed answer is also three and one", () => {
    assert.deepEqual(balanceLastLine(PUBLIC_FOUR, 865, GAP), [
      [0, 1],
      [2, 3],
    ]);
  });

  it("leaves a line the final pair cannot share", () => {
    // 1024: Team and Ort need 629 of a 609 line, so no arrangement puts two on the last line.
    const packed = packLines(PUBLIC_FOUR, 609, GAP);
    assert.deepEqual(balanceLastLine(PUBLIC_FOUR, 609, GAP), packed);
  });

  it("leaves a phone alone, where every cell is already its own line", () => {
    const phone = [314, 314, 314, 314];
    assert.deepEqual(balanceLastLine(phone, 314, GAP), [[0], [1], [2], [3]]);
  });

  it("leaves a single line untouched", () => {
    assert.deepEqual(balanceLastLine(PUBLIC_FOUR, 1034, GAP), [[0, 1, 2, 3]]);
  });

  it("leaves a last line that already holds two", () => {
    const five = [...PUBLIC_FOUR, 176];
    assert.deepEqual(balanceLastLine(five, 1025, GAP), packLines(five, 1025, GAP));
  });

  it("refuses when the head would end on a lone cell of its own", () => {
    // The first two cannot share a line, so moving one down only relocates the gap.
    const sizes = [400, 400, 100, 100];
    assert.deepEqual(balanceLastLine(sizes, 450, GAP), packLines(sizes, 450, GAP));
  });

  it("refuses with fewer than three cells, having no line above to take one from", () => {
    assert.deepEqual(balanceLastLine([400, 100], 300, GAP), [[0], [1]]);
  });

  it("closes the admin surface's third line", () => {
    // Seven facets at 1280: packed as three, three and one.
    const seven = [179, 202, 329, 288, 176, 242, 222];
    assert.deepEqual(packLines(seven, 862, GAP), [[0, 1, 2], [3, 4, 5], [6]]);
    assert.deepEqual(balanceLastLine(seven, 862, GAP), [
      [0, 1, 2],
      [3, 4],
      [5, 6],
    ]);
  });
});
