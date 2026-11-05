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
    ["C10", "calc(11ch + 1.375rem + 2rem)"],
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
    expect(rules.map((rule) => rule.value)).toStrictEqual(["calc(11ch + 1.375rem + 2.5rem)"]);
  });
});

// A frame's edge taking room would leave its parts 2 px short of the touch screen's 40-px target, the calendar button,
// the arrow and the search's text 38 px tall, which no page review sees.
describe("a field frame's edge in the built stylesheet", () => {
  const WIDTHS = ["C2", "C5", "C10", "W3", "column", "fit", "W4"] as const;
  const LAYOUTS = [undefined, "trigger", "group"] as const;
  const classes = new Set(WIDTHS.flatMap((width) => LAYOUTS.flatMap((layout) => fieldFrame({ width, inset: "start", layout }).split(" "))));

  it("takes no room in any frame, a border width set by none of its classes", async () => {
    const widths = await Promise.all(
      [...classes].flatMap((name) => ["border-width", "border-top-width", "border-bottom-width"].map((prop) => declared(name, prop))),
    );
    expect(widths.flat()).toStrictEqual([]);
  });

  it("is drawn all the same, as a 1-px ring inside the frame", async () => {
    const rings = (await Promise.all([...classes].map((name) => declared(name, "--tw-inset-ring-shadow")))).flat();
    expect(rings.map((rule) => rule.value)).toContainEqual(expect.stringMatching(/^inset 0 0 0 1px /));
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
