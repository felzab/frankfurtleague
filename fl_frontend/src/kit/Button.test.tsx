// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Filters } from "./Filters";

import type { FormEvent } from "react";

// The filter row replaces the address through the app router, which no test mounts; nothing here navigates.
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: () => undefined }), usePathname: () => "/" }));

describe("a labelled button with a leading glyph", () => {
  it("draws the glyph before its label, hidden from assistive technology", () => {
    render(
      <Button
        variant="secondary"
        leadingIcon="filter"
        label={COPY.shared.filter}
      />,
    );
    const button = screen.getByRole("button", { name: COPY.shared.filter });
    const glyph = button.firstElementChild;
    expect(glyph?.tagName.toLowerCase()).toBe("svg");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(button.lastChild?.textContent).toBe(COPY.shared.filter);
  });

  it("gives the glyph's place to the spinner while busy, so the button keeps its width", () => {
    render(
      <Button
        variant="secondary"
        leadingIcon="filter"
        label={COPY.shared.filter}
        isBusy
      />,
    );
    const button = screen.getByRole("button", { name: COPY.shared.filter });
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(screen.getByRole("progressbar", { name: COPY.shared.loading })).toBeTruthy();
  });
});

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

describe("a phone's filter button", () => {
  it("leads „Filter“ with the filter glyph and names no count", () => {
    render(<Filters filters={[]} />);
    // The desktop row holds no button; the phone's is the one „Filter“ names.
    const button = screen.getByRole("button", { name: COPY.shared.filter });
    expect(button.querySelector("svg")).not.toBe(null);
    expect(button.textContent).toBe(COPY.shared.filter);
  });
});
