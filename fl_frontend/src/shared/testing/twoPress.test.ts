import "./dom.ts";

import assert from "node:assert/strict";
import { describe, it, mock } from "node:test";

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

    // Held still: on the real clock, a loaded machine spacing the two presses past the window writes.
    mock.timers.enable({ apis: ["Date"] });
    try {
      await user.click(screen.getByRole("button", { name: RESTING }));
      await user.click(screen.getByRole("button", { name: ARMED }));
    } finally {
      mock.timers.reset();
    }

    assert.equal(writes, 0, "two presses inside the window wrote");
  });

  /* A panel whose first press arms only once a read it started has answered, as the season's bulk
     invite send does: the control is armed after the click has already returned. */
  it("waits for a control that arms after its first press returns", async () => {
    const user = userEvent.setup();
    let answerTheRead: () => void = () => undefined;
    const read = new Promise<void>((resolve) => (answerTheRead = resolve));
    let writes = 0;
    render(h(LateProbe, { read, onWrite: () => void (writes += 1) }));

    await pressTwice(
      {
        ...user,
        click: async (element) => {
          await user.click(element);
          // Answered as the click returns, never on a timer a loaded machine could hold past the find's own wait.
          answerTheRead();
        },
      },
      { resting: RESTING, armed: ARMED },
    );

    assert.equal(writes, 1, "the armed press wrote nothing, or wrote twice");
  });
});

/** Arms once `read` has answered after the press that asked for it, and writes on the press after that at once. */
function LateProbe({ read, onWrite }: { read: Promise<void>; onWrite: () => void }): ReturnType<typeof h> {
  const { isConfirming, press } = useTwoPressConfirm();
  const write = async () => {
    onWrite();
  };

  return h(
    "button",
    {
      type: "button",
      onClick: () => (isConfirming ? press(write) : void read.then(() => press(write))),
    },
    isConfirming ? ARMED : RESTING,
  );
}
