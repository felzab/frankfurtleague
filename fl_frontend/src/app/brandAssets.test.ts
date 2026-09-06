import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

/**
 * Read rather than restated: the two assets below are the only places on the site spelling a brand
 * colour outside a stylesheet, so a token moving without them leaves a favicon and an installed app
 * on last season's green.
 */
function schemeTokens(): Map<string, string> {
  const css = readFileSync(path.resolve(import.meta.dirname, "schemes", "2027.css"), "utf8");
  const block = css.slice(css.indexOf(":root,"));

  return new Map(
    [...block.slice(0, block.indexOf("\n  }")).matchAll(/(--[a-z-]+):\s*(#[0-9a-f]{3,8});/g)].map((m) => [m[1] ?? "", m[2] ?? ""]),
  );
}

const ICON = readFileSync(path.resolve(import.meta.dirname, "icon.svg"), "utf8");
const MANIFEST = readFileSync(path.resolve(import.meta.dirname, "manifest.ts"), "utf8");

/** Every hex the icon spells, deduplicated: the mark is two colours and a third is a drift. */
function iconColours(): Set<string> {
  // Case-insensitive and every hex length: an upper-case or three-digit literal is a drift the
  // lower-case six-digit pattern reads as absent rather than as wrong.
  return new Set([...ICON.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()));
}

describe("the brand assets that cannot read a stylesheet", () => {
  it("parses the scheme, so the assertions below are against real values", () => {
    const tokens = schemeTokens();
    // Far above the two read here: a scheme declares its whole set, so a low count means the parse
    // failed and every case below would pass against an empty map.
    assert.ok(tokens.size > 25, `the season scheme was not parsed, so this test proves nothing (${String(tokens.size)} tokens)`);
  });

  it("paints the icon in the scheme's own brand pair", () => {
    const tokens = schemeTokens();
    const fill = tokens.get("--accent-brand-solid");
    const mark = tokens.get("--accent-on-brand");
    assert.ok(fill !== undefined && mark !== undefined, "the scheme declares no brand pair");

    assert.deepEqual(
      [...iconColours()].sort(),
      [fill, mark].sort(),
      "fl_frontend/src/app/icon.svg carries a colour the season scheme does not declare",
    );
  });

  it("opens an installed app on the scheme's brand fill", () => {
    const fill = schemeTokens().get("--accent-brand-solid");
    assert.ok(fill !== undefined);

    for (const key of ["theme_color", "background_color"]) {
      const found = new RegExp(`${key}: "(#[0-9a-f]{6})"`).exec(MANIFEST);
      assert.ok(found !== null, `manifest.ts declares no ${key}`);
      assert.equal(found[1], fill, `manifest.ts's ${key} is not the season scheme's brand fill`);
    }
  });

  it("keeps every drawn feature above the size a favicon renders it at", () => {
    // 16px against a 512 viewBox is 1/32, so 48 units is 1.5 device pixels -- the floor below which
    // a stroke or a bar aliases into the tile it sits on.
    const strokes = [...ICON.matchAll(/stroke-width="(\d+)"/g)].map((m) => Number(m[1]));
    // Both axes, because a narrow bar aliases at a favicon's size exactly as a short one does and
    // a height-only walk reads it as absent.
    const bars = [...ICON.matchAll(/<rect[^>]*\b(?:width|height)="(\d+)"/g)].map((m) => Number(m[1])).filter((n) => n < 512);

    assert.ok(strokes.length > 0 && bars.length > 0, "the icon was not parsed, so this case proves nothing");
    for (const width of [...strokes, ...bars]) assert.ok(width >= 48, `a feature of ${String(width)} units disappears at 16px`);
  });
});
