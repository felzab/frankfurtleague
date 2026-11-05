// @vitest-environment jsdom
import { Activity } from "react";

import { act, render, screen, waitFor, within } from "@testing-library/react";
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
const QUESTION = { verb: "replace", subject: COPY.page.teams, consequence: COPY.shared.noValue, tone: "primary" } as const;

/** An act on the inputs a section holds, in a page Next may hide; `asks` puts the question first. */
const page = ({ inputs, mode = "visible", asks = false }: { inputs: ReadonlyArray<unknown>; mode?: "visible" | "hidden"; asks?: boolean }) => (
  <Activity mode={mode}>
    <SectionAct
      label={LABEL}
      inputs={inputs}
      run={async () => DONE}
      {...(asks ? { confirm: QUESTION } : {})}
    />
  </Activity>
);

const line = () => screen.getAllByRole("status").at(-1);

describe("a section's act", () => {
  // The harm: „Gespeichert“ standing beside inputs that no longer say what was done, a second press under it.
  it("drops its done line once one of its inputs changes", async () => {
    const { rerender } = render(page({ inputs: ["a", "b"] }));
    await userEvent.click(screen.getByRole("button", { name: LABEL }));
    await waitFor(() => expect(line()?.textContent).toBe(COPY.shared.saved));

    rerender(page({ inputs: ["a", "c"] }));
    expect(line()?.textContent).toBe("");
  });

  // The harm: a question's „Gespeichert“ greeting a later visit to the page, as no other act's line does.
  it("drops a question's done line once the page is left", async () => {
    const { rerender } = render(page({ inputs: [], asks: true }));
    await userEvent.click(screen.getByRole("button", { name: LABEL }));
    await userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: COPY.shared.verb.replace }));
    await waitFor(() => expect(line()?.textContent).toBe(COPY.shared.saved));

    for (const mode of ["hidden", "visible"] as const) await act(async () => rerender(page({ inputs: [], asks: true, mode })));
    expect(line()?.textContent).toBe("");
  });
});
