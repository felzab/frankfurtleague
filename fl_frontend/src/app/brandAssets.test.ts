import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { assertEveryTokenIsRead, schemeTokens } from "@/core/schemeReader.ts";

import manifest from "./manifest.ts";

const { viewport } = await import("./layout.tsx");

/**
 * Read rather than restated: the three assets below are the only places spelling a scheme colour
 * outside a stylesheet, so one moving without them leaves a favicon, an installed app and the
 * browser's chrome on the season before.
 */
const SCHEME = readFileSync(path.resolve(import.meta.dirname, "schemes", "2027.css"), "utf8");

const ICON = readFileSync(path.resolve(import.meta.dirname, "icon.svg"), "utf8");

/** Every hex the icon spells, deduplicated: the mark is two colours and a third is a drift. */
function iconColours(): Set<string> {
  // Case-insensitive and every hex length: an upper-case or three-digit literal is a drift the
  // lower-case six-digit pattern reads as absent rather than as wrong.
  return new Set([...ICON.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()));
}

describe("the brand assets that cannot read a stylesheet", () => {
  it("reads every colour the season scheme declares, so the assertions below are against real values", () => {
    assertEveryTokenIsRead(SCHEME);
  });

  it("paints the icon in the scheme's own brand pair", () => {
    const tokens = schemeTokens(SCHEME, "light");
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
    const fill = schemeTokens(SCHEME, "light").get("--accent-brand-solid");
    assert.ok(fill !== undefined);

    const answered = manifest();
    for (const key of ["theme_color", "background_color"] as const)
      assert.equal(answered[key], fill, `manifest.ts's ${key} is not the season scheme's brand fill`);
  });

  // A `<meta>` colour is a literal or nothing: `content` resolves no `var()`, so the head is the
  // third place a scheme colour is spelled by hand.
  it("paints the browser's chrome in each theme's own bar ground", () => {
    const themeColor = viewport.themeColor;
    assert.ok(Array.isArray(themeColor), "the `viewport` export declares no theme colour per colour scheme");

    const schemeOf = (theme: string) => `(prefers-color-scheme: ${theme})`;
    const declared = new Map(themeColor.map(({ media, color }) => [media, color]));
    assert.deepEqual(
      [...declared.keys()].sort(),
      [schemeOf("dark"), schemeOf("light")],
      "the `viewport` export declares no theme colour per colour scheme",
    );

    for (const theme of ["light", "dark"] as const) {
      assert.equal(
        declared.get(schemeOf(theme)),
        schemeTokens(SCHEME, theme).get("--bg-surface"),
        `the ${theme} theme colour is not that theme's ground for the bar under the chrome`,
      );
    }
  });

  it("keeps every drawn feature above the size a favicon renders it at", () => {
    // 16px against a 512 viewBox is 1/32, so 48 units is 1.5 device pixels -- the floor below which
    // a stroke or a bar aliases into the tile it sits on.
    const strokes = [...ICON.matchAll(/stroke-width="(\d+)"/g)].map((m) => Number(m[1]));
    // Each tag first, then both attributes inside it: one pattern over the whole file yields one
    // capture per tag, which is whichever axis the drawing happens to spell last.
    const bars = [...ICON.matchAll(/<rect\b[^>]*>/g)]
      .flatMap((tag) => [...tag[0].matchAll(/\b(?:width|height)="(\d+)"/g)].map((m) => Number(m[1])))
      .filter((n) => n < 512);

    assert.ok(strokes.length > 0 && bars.length > 0, "the icon was not parsed, so this case proves nothing");
    for (const width of [...strokes, ...bars]) assert.ok(width >= 48, `a feature of ${String(width)} units disappears at 16px`);
  });
});
