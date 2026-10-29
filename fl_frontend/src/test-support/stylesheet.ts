import { readFile } from "node:fs/promises";
import path from "node:path";

import tailwind from "@tailwindcss/postcss";
import postcss from "postcss";

import type { Container, Document, Root, Rule } from "postcss";

/** `globals.css` as the build compiles it, every Tailwind utility the tree's sources name included. */
export async function compiledGlobals(): Promise<Root> {
  const from = path.join(import.meta.dirname, "..", "app", "globals.css");
  return (await postcss([tailwind()]).process(await readFile(from, "utf8"), { from })).root;
}

/**
 * A rule's selectors with every ancestor folded in: Tailwind emits nested CSS verbatim, a variant as a nested
 * `&[data-…]`. Split by postcss's `selectors`, since a comma inside `:is(…)` or escaped in a class name, as
 * `var(…,1)` is, is no separator.
 */
export function selectorsOf(rule: Rule): string[] {
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
export function declared(root: Root, name: string, prop: string): { selector: string; value: string }[] {
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
