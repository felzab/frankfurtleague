import { describe, expect, it } from "vitest";
import { z } from "zod";

import { boxesOf, rulesOf } from "./boxRules";

const rulesFor = (input: z.ZodType, examples?: Readonly<Record<string, { record: string }>>) => rulesOf(boxesOf(input), examples);

// The harm: a box whose rule the browser's pass misses is refused only after the press, behind the passkey touch the
// touch and everything typed in its dialog lost, and a rule stricter than the input refuses what the server takes.
describe("a box's rule read off its lane's input", () => {
  it("is required where no empty value passes, and never for a switch", () => {
    expect(rulesFor(z.object({ name: z.string().min(1), note: z.string().nullable(), shown: z.boolean() }))).toStrictEqual({
      name: { required: true },
    });
  });

  it("holds the text's length", () => {
    expect(rulesFor(z.object({ code: z.string().min(5).max(5) }))).toStrictEqual({ code: { required: true, minLength: 5, maxLength: 5 } });
  });

  it("holds the patterns of every shape its text may take", () => {
    expect(rulesFor(z.object({ phone: z.union([z.string().regex(/^\d+$/u), z.string().regex(/^\+\d+$/u)]).nullable() }))).toStrictEqual({
      phone: { patterns: [String.raw`^\d+$`, String.raw`^\+\d+$`] },
    });
  });

  it("holds the figure's bounds, an exclusive one moved a step inward", () => {
    expect(rulesFor(z.object({ fee: z.int().gt(0).max(500) }))).toStrictEqual({ fee: { required: true, min: 1, max: 500 } });
  });

  it("names the example its lane declares, each row of a list by `*`", () => {
    const minute = { record: "45+2" };
    expect(
      rulesFor(z.object({ scorers: z.array(z.object({ minute: z.string().max(6).nullable() })) }), { "scorers.*.minute": minute }),
    ).toStrictEqual({ "scorers.*.minute": { maxLength: 6, example: minute } });
  });
});
