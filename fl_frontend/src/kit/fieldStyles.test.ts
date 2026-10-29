import { compiledGlobals, declared as declaredIn } from "@/test-support/stylesheet.ts";
import { describe, expect, it } from "vitest";

import { dateSegment, fieldFrame } from "./fieldStyles";

const compiled = compiledGlobals();

/** What the built stylesheet declares for one class. */
const declared = async (name: string, prop: string) => declaredIn(await compiled, name, prop);

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
