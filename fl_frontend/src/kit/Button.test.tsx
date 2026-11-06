// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";

import type { FormEvent } from "react";

const REASON = COPY.template.draftUnsaved;

describe("a locked act", () => {
  const acts = [
    { kind: "labelled", act: { variant: "primary", label: COPY.shared.filter } },
    { kind: "icon-only", act: { icon: "erasures", label: COPY.shared.verb.delete } },
  ] as const;

  // The harm: a native `disabled` takes the focus, the hover and the press, so the keys and a finger reach no reason, and
  // an icon's nested tooltip would show its name over the reason.
  it.each(acts)("shows its reason on the keys' focus and on any press, and never runs: $kind", async ({ act }) => {
    const onPress = vi.fn();
    render(
      <Button
        {...act}
        locked={REASON}
        onPress={onPress}
      />,
    );

    await userEvent.tab();
    expect(screen.getByRole("tooltip").textContent).toBe(REASON);

    await userEvent.keyboard("{Enter}");
    expect(within(await screen.findByRole("dialog")).getByText(REASON)).toBeTruthy();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: act.label }));
    expect(within(await screen.findByRole("dialog")).getByText(REASON)).toBeTruthy();
    expect(onPress).not.toHaveBeenCalled();
  });

  // The harm: pressed, or by Enter from a field, a locked submit button would send the form it stands in.
  it("sends no form it stands in", async () => {
    const onSubmit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <Button
          variant="primary"
          type="submit"
          label={COPY.shared.filter}
          locked={REASON}
        />
      </form>,
    );

    await userEvent.click(screen.getByRole("button", { name: COPY.shared.filter }));
    await screen.findByRole("dialog");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
