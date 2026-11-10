// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { SectionAct } from "./SectionAct";

import type { ActionAnswer } from "@/core/action";
import type * as Navigation from "next/navigation";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", async (importOriginal) => ({ ...(await importOriginal<typeof Navigation>()), useRouter: () => router }));

const LABEL = COPY.shared.withObject(COPY.page.teams, "swap");
const DONE: ActionAnswer = { ok: true, value: undefined };

/** An act on the inputs a section holds. */
const page = (inputs: ReadonlyArray<unknown>) => (
  <SectionAct
    acts={[{ label: LABEL, run: async () => DONE }]}
    inputs={inputs}
  />
);

const line = () => screen.getAllByRole("status").at(-1);

describe("a section's act", () => {
  // The harm: „Gespeichert“ standing beside inputs that no longer say what was done, a second press under it.
  it("drops its done line once one of its inputs changes", async () => {
    const { rerender } = render(page(["a", "b"]));
    await userEvent.click(screen.getByRole("button", { name: LABEL }));
    await waitFor(() => expect(line()?.textContent).toBe(COPY.shared.saved));

    rerender(page(["a", "c"]));
    expect(line()?.textContent).toBe("");
  });

  // The harm: a dialog's trigger around the locked button would open the question behind the reason.
  it("answers a press with its reason while locked, never its question", async () => {
    const reason = COPY.template.draftUnsaved;
    render(
      <SectionAct
        acts={[
          {
            label: LABEL,
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
