// @vitest-environment jsdom
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { SectionAct } from "./SectionAct";
import { ToastRegion } from "./Toast";

import type { ActionAnswer } from "@/core/action";

const SWAP = { verb: "swap", object: COPY.page.teams } as const;
const LABEL = COPY.shared.withObject(SWAP.object, SWAP.verb);
const DONE: ActionAnswer = { ok: true, value: undefined };
const REFUSAL = COPY.shared.failure.stale;

/** An act on the inputs a section holds, the frame's toast region beside it. */
const page = (inputs: ReadonlyArray<unknown>, run: () => Promise<ActionAnswer>) => (
  <>
    <SectionAct
      acts={[{ act: SWAP, run }]}
      inputs={inputs}
    />
    <ToastRegion frame="rail" />
  </>
);

// The toast queue is the module's own, so a toast outlives its case: each is closed while the case's region stands.
afterEach(() => {
  for (const close of screen.queryAllByRole("button", { name: COPY.shared.close })) act(() => close.click());
});

describe("a section's act", () => {
  // The harm: a refusal standing beside inputs that no longer hold what was refused, or a done act said as
  // „Gespeichert“ on a line that moves the page, rather than in its own word.
  it("drops a refusal once one of its inputs changes, and says a done act in its verb's toast", async () => {
    const run = vi.fn<() => Promise<ActionAnswer>>().mockResolvedValueOnce({ ok: false, reason: REFUSAL }).mockResolvedValueOnce(DONE);
    const { rerender } = renderUnderNext(page(["a", "b"], run));
    await userEvent.click(screen.getByRole("button", { name: LABEL }));
    await screen.findByText(REFUSAL);

    rerender(page(["a", "c"], run));
    expect(screen.queryByText(REFUSAL)).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: LABEL }));
    await screen.findByRole("alertdialog", { name: COPY.shared.toast.done.swap });
    expect(screen.getByRole("status").textContent).toBe("");
  });

  // The harm: a dialog's trigger around the locked button would open the question behind the reason.
  it("answers a press with its reason while locked, never its question", async () => {
    const reason = COPY.template.draftUnsaved;
    renderUnderNext(
      <SectionAct
        acts={[
          {
            act: SWAP,
            locked: reason,
            confirm: { verb: "swap", subject: COPY.page.teams, consequence: reason, tone: "primary" },
            run: async () => DONE,
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: LABEL }));
    expect((await screen.findByRole("tooltip")).textContent).toBe(reason);
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
