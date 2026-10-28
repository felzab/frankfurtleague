import { readFileSync } from "node:fs";
import path from "node:path";

import postcss from "postcss";
import { assert, describe, expect, it } from "vitest";

import { tv } from "./tv";

/**
 * The namespaces whose names the merger reads from a closed list, each with its utility and a class of the
 * same property it knows already, an arbitrary value or a keyword.
 */
const CLOSED = {
  container: { utility: "max-w", known: "max-w-[1px]" },
  shadow: { utility: "shadow", known: "shadow-none" },
  tracking: { utility: "tracking", known: "tracking-[1px]" },
  text: { utility: "text", known: "text-[1px]" },
  radius: { utility: "rounded", known: "rounded-[1px]" },
} as const;

/** Every class `tokens.css`'s theme names in those namespaces. Parsed by PostCSS, so a commented-out name is not read. */
function themeClasses(): Array<{ token: string; own: string; known: string }> {
  const file = path.resolve(import.meta.dirname, "../app/tokens.css");
  const found: Array<{ token: string; own: string; known: string }> = [];
  postcss.parse(readFileSync(file, "utf8"), { from: file }).walkAtRules("theme", (theme) => {
    theme.walkDecls(/^--/, ({ prop }) => {
      const [, namespace, name] = /^--([a-z]+)-(.+)$/.exec(prop) ?? [];
      // A sub-property such as `--text-xs--line-height` names no class of its own.
      if (namespace === undefined || name === undefined || name.includes("--") || !(namespace in CLOSED)) return;
      const { utility, known } = CLOSED[namespace as keyof typeof CLOSED];
      found.push({ token: prop, own: `${utility}-${name}`, known });
    });
  });
  assert(found.length > 0, "tokens.css's theme names no width, shadow, letterfit, size or corner");
  return found;
}

describe("the kit's recipe builder", () => {
  // Unknown to the merger, a theme name stays beside a later class of its property, or is read as another
  // property and dropped: `shadow-menu` as a shadow colour, so a recipe adding a colour would lose the shadow.
  it.each(themeClasses())("resolves $token against a later class of its property, in either order", ({ own, known }) => {
    const recipe = tv({ base: own, variants: { later: { true: known } } });
    expect(recipe({ later: true })).toBe(known);
    expect(tv({ base: known, variants: { later: { true: own } } })({ later: true })).toBe(own);
  });

  it("keeps a theme shadow beside a shadow colour", () => {
    expect(tv({ base: "shadow-menu", variants: { tinted: { true: "shadow-fg" } } })({ tinted: true })).toBe("shadow-menu shadow-fg");
  });
});
