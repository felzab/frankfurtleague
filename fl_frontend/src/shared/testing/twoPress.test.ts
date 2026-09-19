import "./dom.ts";

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createElement as h } from "react";

import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";

import { useTwoPressConfirm } from "@/shared/hooks/useTwoPressConfirm.ts";

import { pressTwice } from "./twoPress.ts";

const RESTING = "Löschen";
const ARMED = "Ja, löschen";

/** The escalating control as the panels spell it: one button whose name is the state it is in. */
function Probe({ onWrite }: { onWrite: () => void }): ReturnType<typeof h> {
  const { isConfirming, press } = useTwoPressConfirm();

  return h(
    "button",
    {
      type: "button",
      onClick: () =>
        press(async () => {
          onWrite();
        }),
    },
    isConfirming ? ARMED : RESTING,
  );
}

describe("the helper that confirms a two-press control", () => {
  it("arms on the first press and writes on the second", async () => {
    const user = userEvent.setup();
    let writes = 0;
    render(h(Probe, { onWrite: () => void (writes += 1) }));

    await pressTwice(user, {
      resting: RESTING,
      armed: ARMED,
      whileArmed: () => {
        assert.equal(writes, 0, "one press wrote");
      },
    });

    assert.equal(writes, 1, "the armed press wrote nothing, or wrote twice");
  });

  /* Without the tick the hook reads the pair as one double click and ignores the second press, so a
     helper that dropped it would leave every panel's case asserting over a write that never ran. */
  it("owes its second press to the clock it moves past the double-click window", async () => {
    const user = userEvent.setup();
    let writes = 0;
    render(h(Probe, { onWrite: () => void (writes += 1) }));

    await user.click(screen.getByRole("button", { name: RESTING }));
    await user.click(screen.getByRole("button", { name: ARMED }));

    assert.equal(writes, 0, "two presses inside the window wrote");
  });
});
