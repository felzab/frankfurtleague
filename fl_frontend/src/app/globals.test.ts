import { readFile } from "node:fs/promises";
import path from "node:path";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import type { Container, Document, Root, Rule } from "postcss";

/** `globals.css` as the build compiles it, every Tailwind utility the tree's sources name included. */
async function compiledGlobals(): Promise<Root> {
  const from = path.join(import.meta.dirname, "globals.css");
  return (await postcss([tailwind()]).process(await readFile(from, "utf8"), { from })).root;
}

/**
 * A rule's selectors with every ancestor folded in: Tailwind emits nested CSS verbatim, a variant as a nested
 * `&[data-…]`. Split by postcss's `selectors`, since a comma inside `:is(…)` or escaped in a class name, as
 * `var(…,1)` is, is no separator.
 */
function selectorsOf(rule: Rule): string[] {
  const chain: Rule[] = [];
  for (let node: Container | Document | undefined = rule.parent; node != null; node = node.parent) {
    if (node.type === "rule") chain.unshift(node as Rule);
  }

  return [...chain, rule].reduce<string[]>(
    (outer, level) =>
      level.selectors.flatMap((part) =>
        outer.length === 0 ? [part] : outer.map((base) => (part.includes("&") ? part.replaceAll("&", base) : `${base} ${part}`)),
      ),
    [],
  );
}

/** What `root` declares for one class, each declaration with the selector it stands under. */
function declared(root: Root, name: string, prop: string): { selector: string; value: string }[] {
  const found: { selector: string; value: string }[] = [];
  root.walkRules((rule) => {
    const selectors = selectorsOf(rule)
      .map((selector) => selector.replace(/\\(.)/g, "$1"))
      .filter((selector) => selector.includes(`.${name}`));
    if (selectors.length === 0) return;
    // Own declarations only: the walk visits a nested rule on its own.
    for (const decl of rule.nodes) {
      if (decl.type === "decl" && decl.prop === prop) found.push({ selector: selectors.join(", "), value: decl.value });
    }
  });
  return found;
}

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
