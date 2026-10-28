import { readFileSync } from "node:fs";
import path from "node:path";

import postcss from "postcss";
import { assert, describe, expect, it, vi } from "vitest";

import manifest from "./manifest.ts";

// Next's font loader runs only inside its own build; nothing asserted here is decided by a face.
vi.mock("next/font/google", () => {
  const face = () => ({ className: "", variable: "", style: { fontFamily: "" } });
  return { Anton: face, Inter: face, Raleway: face };
});

const { viewport } = await import("./layout.tsx");

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

  it("opens an installed app on the brand fill", () => {
    const fill = tokensOf("light").get("--brand-solid");
    assert(fill !== undefined, "tokens.css declares no --brand-solid");

    const answered = manifest();
    for (const key of ["theme_color", "background_color"] as const)
      expect(answered[key], `manifest.ts's ${key} is not --brand-solid`).toBe(fill);
  });

  it("paints the browser's chrome in each theme's own bar ground", () => {
    const themeColor = viewport.themeColor;
    assert(Array.isArray(themeColor), "the `viewport` export declares no theme colour per colour scheme");

    const schemeOf = (theme: string) => `(prefers-color-scheme: ${theme})`;
    const declared = new Map(themeColor.map(({ media, color }) => [media, color]));
    expect([...declared.keys()].sort(), "the `viewport` export declares no theme colour per colour scheme").toStrictEqual([
      schemeOf("dark"),
      schemeOf("light"),
    ]);

    for (const theme of ["light", "dark"] as const) {
      expect(declared.get(schemeOf(theme)), `the ${theme} theme colour is not that theme's --bg-surface`).toBe(
        tokensOf(theme).get("--bg-surface"),
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

    assert(strokes.length > 0 && bars.length > 0, "the icon was not parsed, so this case proves nothing");
    for (const width of [...strokes, ...bars])
      expect(width, `a feature of ${String(width)} units disappears at 16px`).toBeGreaterThanOrEqual(48);
  });
});
