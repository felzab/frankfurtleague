import { describe, expect, it } from "vitest";
import { z } from "zod";

import { COPY } from "./copy/shared";
import { fieldMessage } from "./zodGerman";

const { field } = COPY.shared;

/** The line a box shows for the first issue a parse of `input` raises, the German map handed it as a form hands it. */
const lineFor = (schema: z.ZodType, input: unknown) =>
  schema.safeParse(input, { error: (issue) => fieldMessage(issue) }).error?.issues[0]?.message;

describe("a number's line", () => {
  /* `z.int()` publishes the safe integers' edge as its own bounds, which no person types toward: a line naming it
     tells a person who typed 0 that the box takes up to nine quadrillion. */
  it("names every bound a rule sets on an integer, never the integer's own range", () => {
    expect(lineFor(z.int().min(1), 0)).toBe(field.min(1));
    expect(lineFor(z.int().max(9), 10)).toBe(field.max(9));
    expect(lineFor(z.int().min(1).max(9), 0)).toBe(field.between(1, 9));
  });
});
