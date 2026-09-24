import { mock } from "node:test";

import { screen } from "@testing-library/react";

import { DOUBLE_PRESS_MS } from "@/shared/hooks/useTwoPressConfirm.ts";

import type { userEvent } from "@testing-library/user-event";

/**
 * Both presses of a confirm control, the second past the window the hook reads as one double click.
 *
 * The clock is faked rather than waited out: a real wait would put half a second into every
 * escalating panel's file.
 */
export async function pressTwice(
  user: ReturnType<typeof userEvent.setup>,
  {
    resting,
    armed,
    whileArmed,
  }: {
    /** The control's accessible name before the first press, and after it. */
    resting: string | RegExp;
    armed: string | RegExp;
    /** Read between the presses — what the arming press put on screen, which the second press clears. */
    whileArmed?: () => void | Promise<void>;
  },
): Promise<void> {
  mock.timers.enable({ apis: ["Date"] });
  try {
    await user.click(screen.getByRole("button", { name: resting }));
    // Found rather than got: a panel that arms once a read it started has answered is armed after the click returns.
    await screen.findByRole("button", { name: armed });
    await whileArmed?.();
    mock.timers.tick(DOUBLE_PRESS_MS);
    await user.click(screen.getByRole("button", { name: armed }));
  } finally {
    mock.timers.reset();
  }
}
