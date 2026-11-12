import { describe, it } from "vitest";

import { COPY } from "./copy.ts";

import type { Copy } from "./copy.ts";

const show = (text: Copy): Copy => text;

describe("Copy", () => {
  it("takes a catalogue entry and refuses a string typed in place", () => {
    show(COPY.shared.saved);
    show(COPY.shared.field.maxChars(80));
    // @ts-expect-error -- the refusal under test: a raw string is no `Copy`.
    show("Gespeichert");
  });
});
