import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { assertEveryTokenIsRead, schemeTokens } from "@/core/schemeReader.ts";

/**
 * Read rather than restated: the three assets below are the only places spelling a scheme colour
 * outside a stylesheet, so one moving without them leaves a favicon, an installed app and the
 * browser's chrome on the season before.
 */
const SCHEME = readFileSync(path.resolve(import.meta.dirname, "schemes", "2027.css"), "utf8");

const ICON = readFileSync(path.resolve(import.meta.dirname, "icon.svg"), "utf8");

function exportBody(file: string, opener: RegExp, what: string): string {
  // Blanked rather than dropped, so a commented-out block cannot answer for the live one.
  const source = readFileSync(path.resolve(import.meta.dirname, file), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
  const opened = opener.exec(source);
  if (opened === null) throw new Error(`${what} is not declared where this reads it`);

  let depth = 1;
  for (let offset = opened.index + opened[0].length; offset < source.length; offset++) {
    if (source[offset] === "{") depth++;
    if (source[offset] === "}") depth--;
    if (depth === 0) return source.slice(opened.index + opened[0].length, offset);
  }
  throw new Error(`${what} is never closed`);
}

/**
 * Sliced to the export Next resolves rather than read whole: a literal outside it reaches no
 * output, so a matcher over the file passes a renamed export and a commented-out block alike.
 */
const MANIFEST = exportBody("manifest.ts", /export default function\b[^{]*\{/, "manifest.ts's default export");
const VIEWPORT = exportBody("layout.tsx", /export const viewport\b[^={]*=\s*\{/, "layout.tsx's `viewport` export");

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

    for (const key of ["theme_color", "background_color"]) {
      const found = new RegExp(`${key}: "(#[0-9a-f]{6})"`).exec(MANIFEST);
      assert.ok(found !== null, `manifest.ts declares no ${key}`);
      assert.equal(found[1], fill, `manifest.ts's ${key} is not the season scheme's brand fill`);
    }
  });

  // A `<meta>` colour is a literal or nothing: `content` resolves no `var()`, so the head is the
  // third place a scheme colour is spelled by hand rather than a render this could read instead.
  it("paints the browser's chrome in each theme's own bar ground", () => {
    const declared = new Map(
      [...VIEWPORT.matchAll(/media: "\(prefers-color-scheme: (light|dark)\)", color: "(#[0-9a-f]{6})"/g)].map((found) => [
        found[1] ?? "",
        found[2] ?? "",
      ]),
    );
    assert.deepEqual([...declared.keys()].sort(), ["dark", "light"], "the `viewport` export declares no theme colour per colour scheme");

    for (const theme of ["light", "dark"] as const) {
      assert.equal(
        declared.get(theme),
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
