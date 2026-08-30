import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toFieldErrors } from "./validation.ts";

import type { ZodError } from "zod";

/** Only `issues` is read, so a literal stands in for a parse nothing here needs to perform. */
const errorWith = (issues: { path: PropertyKey[]; message: string }[]) => ({ issues }) as unknown as ZodError;

describe("toFieldErrors", () => {
  it("keys each message by its dotted path", () => {
    const found = toFieldErrors(errorWith([{ path: ["kader", "gute_spieler"], message: "Zu viele." }]));

    assert.deepEqual(found, { "kader.gute_spieler": "Zu viele." });
  });

  it("keeps the FIRST message on a path, which is the one the field shows", () => {
    // Two refines can land on one path; the field renders whichever this function keeps.
    const found = toFieldErrors(
      errorWith([
        { path: ["ende"], message: "Das Ende darf nicht vor dem Beginn liegen." },
        { path: ["ende"], message: "Wähle einen Tag innerhalb der Saison." },
      ]),
    );

    assert.deepEqual(found, { ende: "Das Ende darf nicht vor dem Beginn liegen." });
  });

  it("carries a path named for a prototype key, which `in` would drop in silence", () => {
    // `"constructor" in {}` is true, so an `in` membership test reads the slot as already taken and the
    // message is never written. The field then renders nothing and the fallback toast claims no field shows it.
    const found = toFieldErrors(errorWith([{ path: ["constructor"], message: "Bitte gib etwas ein." }]));

    assert.deepEqual(found, { constructor: "Bitte gib etwas ein." });
  });

  it("attaches nothing for an issue with no path, which belongs to no field", () => {
    assert.deepEqual(toFieldErrors(errorWith([{ path: [], message: "Etwas stimmt nicht." }])), {});
  });
});
