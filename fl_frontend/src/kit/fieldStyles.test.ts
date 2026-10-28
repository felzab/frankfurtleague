import { compiledGlobals, selectorsOf } from "@/test-support/stylesheet.ts";
import { describe, expect, it } from "vitest";

import { dateSegment, fieldFrame } from "./fieldStyles";

const compiled = compiledGlobals();

const unescape = (selector: string): string => selector.replace(/\\(.)/g, "$1");

/** What the built stylesheet declares for one class, each declaration with the selector it stands under. */
async function declared(name: string, prop: string): Promise<{ selector: string; value: string }[]> {
  const found: { selector: string; value: string }[] = [];
  (await compiled).walkRules((rule) => {
    const selectors = selectorsOf(rule)
      .map(unescape)
      .filter((selector) => selector.includes(`.${name}`));
    if (selectors.length === 0) return;
    // Own declarations only: the walk visits a nested rule on its own.
    for (const decl of rule.nodes) {
      if (decl.type === "decl" && decl.prop === prop) found.push({ selector: selectors.join(", "), value: decl.value });
    }
  });
  return found;
}

/** The one class of a recipe's output that names a width. */
const widthOf = (classes: string) => classes.split(" ").filter((name) => /^w-/.test(name));

describe("a short field's width in the built stylesheet", () => {
  it.each([
    ["C2", "calc(3ch + 1.375rem)"],
    ["C5", "calc(6ch + 1.375rem)"],
    ["C10", "calc(11ch + 1.375rem + 2.25rem)"],
  ] as const)("sets %s to %s, in characters of the field's own font", async (width, value) => {
    const [name] = widthOf(fieldFrame({ width, inset: "full" }));
    expect(name).toBeDefined();
    expect((await declared(name!, "width")).map((rule) => rule.value)).toStrictEqual([value]);
  });

  it("widens a date's group on a touch screen by its wider calendar button", async () => {
    const coarse = fieldFrame({ width: "C10", inset: "start", layout: "group" })
      .split(" ")
      .find((name) => name.startsWith("pointer-coarse:w-"));
    expect(coarse).toBeDefined();
    const rules = await declared(coarse!, "width");
    expect(rules.map((rule) => rule.value)).toStrictEqual(["calc(11ch + 1.375rem + 2.75rem)"]);
  });
});

describe("a date's empty segment in the built stylesheet", () => {
  it("sets its placeholder in capitals, and only while it is a placeholder", async () => {
    const name = dateSegment()
      .split(" ")
      .find((part) => part.endsWith(":uppercase"));
    expect(name).toBeDefined();
    const rules = await declared(name!, "text-transform");
    expect(rules.map((rule) => rule.value)).toStrictEqual(["uppercase"]);
    expect(rules[0]?.selector).toContain("[data-placeholder]");
  });
});
