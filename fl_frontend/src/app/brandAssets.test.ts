import { readFileSync } from "node:fs";
import path from "node:path";

import postcss from "postcss";
import { assert, describe, expect, it } from "vitest";

import { THEME_COLOR } from "@/core/themeColor";

import manifest from "./manifest.ts";

/** The token blocks of `tokens.css`, by the selector each theme opens. */
const THEME_SELECTOR = { light: ":root", dark: '[data-theme="dark"]' } as const;

/**
 * Every custom property one theme's block declares. Parsed by PostCSS rather than matched, so a
 * declaration inside a comment, or two joined on one line, reads as the stylesheet reads it.
 */
function tokensOf(theme: keyof typeof THEME_SELECTOR): Map<string, string> {
  const file = path.resolve(import.meta.dirname, "tokens.css");
  const tokens = new Map<string, string>();
  postcss.parse(readFileSync(file, "utf8"), { from: file }).walkRules((rule) => {
    if (rule.selector !== THEME_SELECTOR[theme]) return;
    rule.walkDecls(/^--/, (declaration) => void tokens.set(declaration.prop, declaration.value.toLowerCase()));
  });
  // An empty map would answer every comparison below with `undefined` on both sides of nothing.
  assert(tokens.size > 0, `tokens.css opens no ${theme} block at ${THEME_SELECTOR[theme]}`);
  return tokens;
}

const ICON = readFileSync(path.resolve(import.meta.dirname, "icon.svg"), "utf8");

/** Every hex the icon spells, deduplicated: the mark is two colours and a third is a drift. */
function iconColours(): Set<string> {
  // Case-insensitive and every hex length: an upper-case or three-digit literal is a drift the
  // lower-case six-digit pattern reads as absent rather than as wrong.
  return new Set([...ICON.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()));
}

/*
 * The three assets that cannot read a stylesheet copy a token's value by hand: the icon is an SVG
 * file, the manifest is served as JSON, and a `<meta>` colour resolves no `var()`. A token moving
 * without them leaves a favicon, an installed app and the browser's chrome on the colour before.
 */
describe("the brand assets that cannot read a stylesheet", () => {
  it("paints the icon in the brand fill and its accent", () => {
    const light = tokensOf("light");

    expect([...iconColours()].sort(), "fl_frontend/src/app/icon.svg carries a colour tokens.css does not declare").toStrictEqual(
      [light.get("--brand-solid"), light.get("--brand-accent")].sort(),
    );
  });

  it("opens an installed app on the brand fill, under the browser bar's ground", () => {
    const light = tokensOf("light");
    const fill = light.get("--brand-solid");
    const bar = light.get("--bg-surface");
    assert(fill !== undefined && bar !== undefined, "tokens.css declares no --brand-solid or no --bg-surface");

    const answered = manifest();
    expect(answered.background_color, "manifest.ts's background_color is not --brand-solid").toBe(fill);
    // One value with no colour-scheme media: the light theme's, the page's own metas carrying the dark one.
    expect(answered.theme_color, "manifest.ts's theme_color is not the light theme's --bg-surface").toBe(bar);
  });

  it("paints the browser's chrome in each theme's own bar ground", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(THEME_COLOR[theme], `the ${theme} theme colour is not that theme's --bg-surface`).toBe(tokensOf(theme).get("--bg-surface"));
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

    assert(strokes.length > 0 && bars.length > 0, "the icon was not parsed, so this case proves nothing");
    for (const width of [...strokes, ...bars])
      expect(width, `a feature of ${String(width)} units disappears at 16px`).toBeGreaterThanOrEqual(48);
  });
});
