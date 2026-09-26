import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { BRAND_ICON_BUTTON_CLASSES, BRAND_TILE_CLASSES, SHORTHAND_CHIP_CLASSES } from "./brandTile.ts";

/**
 * What identifies each box: the fill, the box size and the radius. A grade changed here moves in
 * `fl_frontend/eslint.config.mjs :: SOURCE_BANS` too, which refuses the same three spelled anywhere else.
 */
const GRADES = {
  BRAND_TILE_CLASSES: ["bg-brand-solid", "size-10", "rounded-xl"],
  BRAND_ICON_BUTTON_CLASSES: ["bg-brand-solid", "size-9", "rounded-xl"],
  // Width-free, that being the caller's: what identifies the chip is its fill, its radius and its weight.
  SHORTHAND_CHIP_CLASSES: ["bg-brand-solid", "rounded-md", "font-extrabold"],
};

describe("the brand box every surface draws", () => {
  it("composes each box out of its own grade", () => {
    for (const [name, spelled] of [
      ["BRAND_TILE_CLASSES", BRAND_TILE_CLASSES],
      ["BRAND_ICON_BUTTON_CLASSES", BRAND_ICON_BUTTON_CLASSES],
      ["SHORTHAND_CHIP_CLASSES", SHORTHAND_CHIP_CLASSES],
    ] as const) {
      const tokens = spelled.split(" ");

      for (const token of GRADES[name]) assert.ok(tokens.includes(token), `${name} composes to ${spelled}, which drops ${token}`);
    }
  });
});
