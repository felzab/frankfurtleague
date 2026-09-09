import assert from "node:assert/strict";

type SchemeTheme = "light" | "dark";

// Both selectors, so the bare `:root` a `prefers-reduced-motion` block opens is not a token block.
const OPENER: Record<SchemeTheme, RegExp> = {
  light: /:root\s*,\s*\[data-theme=["']light["']\]\s*\{/,
  dark: /\[data-theme=["']dark["']\]\s*\{/,
};

/** Every declaration the block makes, whatever its value is spelled as. */
const DECLARATION = /^[ \t]*(--[a-z0-9-]+)[ \t]*:[ \t]*(.+?)[ \t]*;/gm;

/** The colours alone, and the matcher every case reading a scheme colour goes through. */
const HEX = /(--[a-z-]+):\s*(#[0-9a-f]{3,8});/g;

// Case-insensitive where `HEX` is not, so a value the colour matcher skips for its spelling alone
// is reported rather than counted as absent.
const BARE_HEX = /^#[0-9a-f]{3,8}$/i;

/**
 * One theme block's body, comments blanked.
 *
 * Blanked rather than dropped so a declaration inside a comment cannot be read as one the block
 * makes, which is `scripts/checks/docs_gate/scheme.py :: _read`'s reason too.
 */
function blockBody(css: string, theme: SchemeTheme): string {
  const blanked = css.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const opened = OPENER[theme].exec(blanked);

  // Throws rather than answering with an empty block: every comparison below is satisfied vacuously
  // by one, and a floor stated as a number passes a block that has lost most of what it declares.
  if (opened === null) throw new Error(`the season scheme opens no ${theme} block`);

  let depth = 1;
  for (let offset = opened.index + opened[0].length; offset < blanked.length; offset++) {
    // Brace depth rather than the closing indentation: no declaration carries a brace, so the count
    // parts the block from the `@layer` around it however the file is indented.
    if (blanked[offset] === "{") depth++;
    if (blanked[offset] === "}") depth--;
    if (depth === 0) return blanked.slice(opened.index + opened[0].length, offset);
  }
  throw new Error(`the season scheme's ${theme} block is never closed`);
}

/** The colours one theme block declares, keyed by the property that carries each. */
export function schemeTokens(css: string, theme: SchemeTheme): Map<string, string> {
  return new Map([...blockBody(css, theme).matchAll(HEX)].map((found) => [found[1] ?? "", found[2] ?? ""]));
}

/** Every property the block declares, reached by splitting rather than by matching. */
function propertyNames(body: string): string[] {
  return body
    .split(";")
    .map((fragment) => fragment.trim())
    .filter((fragment) => fragment.startsWith("--") && fragment.includes(":"))
    .map((fragment) => fragment.slice(0, fragment.indexOf(":")).trim());
}

function declarations(css: string, theme: SchemeTheme): Map<string, string> {
  const body = blockBody(css, theme);
  const found = new Map([...body.matchAll(DECLARATION)].map((match) => [match[1] ?? "", match[2] ?? ""]));
  if (found.size === 0) throw new Error(`the season scheme's ${theme} block declares nothing`);

  // The reference parse needs a reference of its own, or a reformat joining two declarations onto
  // one line defeats `DECLARATION`'s anchor and drops that property out of the population unread.
  assert.deepEqual(
    [...found.keys()].sort(),
    propertyNames(body).sort(),
    `the ${theme} block declares a property the declaration reader did not match`,
  );

  return found;
}

/**
 * A matcher that has stopped seeing a spelling returns a smaller map rather than an error, so what
 * catches it is a second parse to compare against and never the size of what the first returned.
 */
export function assertEveryTokenIsRead(css: string): void {
  const read = { light: schemeTokens(css, "light"), dark: schemeTokens(css, "dark") };
  for (const theme of ["light", "dark"] as const) {
    for (const [name, value] of declarations(css, theme)) {
      if (!BARE_HEX.test(value)) continue;
      assert.ok(read[theme].has(name), `the ${theme} block declares ${name} as a colour and the scheme reader did not read it`);
    }
  }

  // The light block alone declares `--focus` (`scripts/checks/docs_gate/scheme.py :: LIGHT_ONLY`),
  // so this parity holds only while every light-only property is spelled as something the hex
  // matcher skips -- a `var()` rather than a colour.
  assert.deepEqual(
    [...read.light.keys()].sort(),
    [...read.dark.keys()].sort(),
    "one theme block of the season scheme declares a colour the other does not",
  );
}
