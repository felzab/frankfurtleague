import { expect, it, vi } from "vitest";
import { z } from "zod";

import { COPY } from "./core/copy.ts";

// The boot gates and sweeps are their own suites': this one asks only what the hook does before them.
vi.mock("./instrumentation-node", () => ({ registerOnNode: async () => {} }));

const { register } = await import("./instrumentation.ts");

const meldung = (schema: z.ZodType, wert: unknown) => schema.safeParse(wert).error?.issues[0]?.message;

it("words every server parse in the German map once the server starts, below a message a schema names itself", async () => {
  // Zod's own English, so the case proves the start's install and never a map another suite left on `globalThis`.
  z.config({ customError: undefined });
  expect(meldung(z.string().max(2), "abc")).not.toBe(COPY.shared.feld.hoechstensZeichen(2));

  await register();

  expect(meldung(z.string().max(2), "abc")).toBe(COPY.shared.feld.hoechstensZeichen(2));
  expect(meldung(z.string().max(2, { error: "Höchstens 2 in der Reihe" }), "abc")).toBe("Höchstens 2 in der Reihe");
});
