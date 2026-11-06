// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { SeatActs } from "./SeatActs";

import type { ActionAnswer } from "@/core/action";

const state = vi.hoisted(() => ({ toasts: [] as unknown[][], refreshes: 0 }));

vi.mock("next/navigation", async (original) => ({
  ...(await original<object>()),
  useRouter: () => ({
    refresh: () => {
      state.refreshes += 1;
    },
  }),
}));
vi.mock("@/kit/Toast", () => ({ appToast: (...toast: unknown[]) => state.toasts.push(toast) }));

const RULES = {
  required: { first_name: true, last_name: true, email: true, phone: true },
  max: { first_name: 80, last_name: 80, email: 254 },
};

async function press(send: () => Promise<ActionAnswer>) {
  render(
    <SeatActs
      rollen={["trainer"]}
      person={null}
      rules={RULES}
      write={async () => ({ ok: true, value: undefined })}
      carry={{}}
      link={{ send, seat: undefined }}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: COPY.shared.withObject(COPY.account.address.link, "send") }));
}

beforeEach(() => {
  state.toasts = [];
  state.refreshes = 0;
});

describe("„Link senden“", () => {
  /* A lost answer, unguarded, replaces the page with the error boundary, though the link may have gone out. */
  it("reads the page again where the answer was lost", async () => {
    await press(async () => {
      throw new Error("lost");
    });

    expect(state.toasts).toStrictEqual([["danger", COPY.shared.failure.stale]]);
    expect(state.refreshes).toBe(1);
  });

  /* The generic line sends the administrator to a retry the same rule refuses again. */
  it("says a refusal in its own words", async () => {
    await press(async () => ({ ok: false, reason: COPY.shared.failure.accessGone }));

    expect(state.toasts).toStrictEqual([["danger", COPY.shared.failure.accessGone]]);
  });
});
