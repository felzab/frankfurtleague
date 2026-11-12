import { compiledGlobals, declared, selectorsOf } from "@/test-support/stylesheet.ts";
import { describe, expect, it } from "vitest";

import type { Container, Document, Rule } from "postcss";

// Compiled once for both cases, which only read it.
const compiled = compiledGlobals();

/*
 * `font-numeric` alone sets a readout's figures in columns: no lint pairs it with `tabular-nums`, so the one
 * theme line in `globals.css` naming the feature is all that holds a table's digits under each other.
 */
describe("the numerals in the built stylesheet", () => {
  it("sets tabular figures wherever font-numeric stands", async () => {
    const root = await compiled;
    const settings = declared(root, "font-numeric", "font-feature-settings").map(({ value }) => {
      // Tailwind emits the feature through the theme variable beside the family.
      const variable = /^var\((--[\w-]+)\)$/.exec(value)?.[1];
      if (variable === undefined) return value;
      const resolved: string[] = [];
      root.walkDecls(variable, (decl) => void resolved.push(decl.value));
      return resolved.join(", ");
    });

    expect(settings).toStrictEqual(['"tnum"']);
  });
});

/*
 * The theme's reset removes Tailwind's line heights with its sizes, and a size declared without its own sets none: its
 * text takes whatever line height it inherits, which compiles, lints and type-checks.
 */
describe("the type sizes in the built stylesheet", () => {
  it("sets a line height wherever a theme size sets the font size", async () => {
    const root = await compiled;
    const sized: Array<{ selector: string; lineHeight: boolean }> = [];
    root.walkDecls("font-size", (decl) => {
      if (!/^var\(--text-[\w-]+\)$/.test(decl.value)) return;
      // A variant's declarations stand inside its at-rule, nested in the class's rule.
      let rule: Container | Document | undefined = decl.parent;
      while (rule !== undefined && rule.type !== "rule") rule = rule.parent;
      sized.push({
        selector: rule === undefined ? "" : selectorsOf(rule as Rule).join(", "),
        lineHeight: decl.parent?.some((sibling) => sibling.type === "decl" && sibling.prop === "line-height") ?? false,
      });
    });

    expect(sized.length).toBeGreaterThan(0);
    expect(sized.filter(({ lineHeight }) => !lineHeight).map(({ selector }) => selector)).toStrictEqual([]);
  });
});
