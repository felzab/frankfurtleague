import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { Leer } = await import("./Angabe.tsx");
const { NICHT_HINTERLEGT } = await import("@/shared/utils/format.ts");

describe("the one grade an empty value takes", () => {
  it("reads an empty stored fact as „Nicht hinterlegt“ unless told its own words", () => {
    render(h("p", null, h(Leer), " ", h(Leer, null, "Nicht bestätigt")));

    assert.ok(screen.getByText(NICHT_HINTERLEGT), "an empty fact lost the stored-fact wording");
    assert.ok(screen.getByText("Nicht bestätigt"), "a state lost its own words");
  });

  /* Muted and upright, and nothing else: size and weight are the slot's, so a value's place in the
     hierarchy holds whether it is filled or not. */
  it("is muted and upright, and leaves size and weight to the slot", () => {
    render(h(Leer));
    const grade = screen.getByText(NICHT_HINTERLEGT).className.split(/\s+/);

    assert.ok(grade.includes("text-foreground-muted"), `the empty value lost the muted ink: ${grade.join(" ")}`);
    assert.ok(grade.includes("not-italic") && !grade.includes("italic"), `the empty value is slanted: ${grade.join(" ")}`);
    assert.deepEqual(
      grade.filter((token) => /^(fluid-|text-(xs|sm|base|lg|xl)|font-)/.test(token)),
      [],
      "the empty value sets a size or a weight of its own",
    );
  });
});
