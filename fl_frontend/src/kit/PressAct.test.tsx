// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { PressAct } from "./PressAct";
import { ToastRegion } from "./Toast";

import type { ActionAnswer } from "@/core/action";

const state = vi.hoisted(() => ({ refreshes: 0 }));

vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({
    refresh: () => {
      state.refreshes += 1;
    },
  }),
}));

const LABEL = COPY.shared.withObject(COPY.account.address.link, "send");

async function press(act: (seat: string) => Promise<ActionAnswer>) {
  render(
    <>
      <ToastRegion frame="rail" />
      <PressAct
        variant="primary"
        label={LABEL}
        act={act}
        payload="trainer"
        done={COPY.shared.toast.linkSent}
      />
    </>,
  );
  await userEvent.click(screen.getByRole("button", { name: LABEL }));
}

beforeEach(() => {
  state.refreshes = 0;
});

// The queue is the toast module's own: a done act's toast runs out before the next test, and a refusal's, which stands
// until it is closed, is read by no later case here.
afterEach(() => {
  vi.useFakeTimers();
  act(() => vi.runAllTimers());
  vi.useRealTimers();
});

describe("an act done at once", () => {
  // A lost answer, unguarded, replaces the page with the error boundary, though the act may have happened.
  it("reads the page again where the answer was lost, and says so", async () => {
    await press(async () => {
      throw new Error("lost");
    });

    expect(await screen.findByText(COPY.shared.failure.stale)).toBeTruthy();
    expect(state.refreshes).toBe(1);
  });
});
