import "@/shared/testing/dom.ts";
import "@/shared/testing/renderTest.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h, useState } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

/* `await import`, never a static import beside the harness (`docs/frontend/spec.md` §1.9). */
const { Label } = await import("@heroui/react/label");
const { NumberField } = await import("./NumberField.tsx");

/** A box as a form holds one: its value in state, every commit written down. */
function Box({ initial, seen }: { initial: number | null; seen: (number | null)[] }) {
  const [value, setValue] = useState(initial);

  return h(
    NumberField,
    {
      value,
      onChange: (next: number | null) => {
        seen.push(next);
        setValue(next);
      },
    },
    h(Label, null, "Tore"),
    h(NumberField.Group, null, h(NumberField.Input)),
  );
}

describe("the shared number field", () => {
  /* A fixture with no goals recorded and one that ended 0:0 are different facts: an emptied box is
     nobody entering a number, and a 0 there would save one. */
  it("records an emptied box as null, and a typed zero as zero", async () => {
    const user = userEvent.setup();
    const seen: (number | null)[] = [];
    render(h(Box, { initial: 3, seen }));
    const box = screen.getByLabelText("Tore");

    await user.clear(box);
    await user.tab();
    assert.equal(seen.at(-1), null, "an emptied box recorded a number");
    assert.equal((box as HTMLInputElement).value, "", "the box shows a number after it was emptied");

    await user.type(box, "0");
    await user.tab();
    assert.equal(seen.at(-1), 0, "a typed zero was not recorded as zero");
  });
});
