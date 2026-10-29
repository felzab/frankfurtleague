import { compiledGlobals, declared } from "@/test-support/stylesheet.ts";
import { describe, expect, it } from "vitest";

/*
 * `font-numeric` alone sets a readout's figures in columns: no lint pairs it with `tabular-nums`, so the one
 * theme line in `globals.css` naming the feature is all that holds a table's digits under each other.
 */
describe("the numerals in the built stylesheet", () => {
  it("sets tabular figures wherever font-numeric stands", async () => {
    const root = await compiledGlobals();
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
