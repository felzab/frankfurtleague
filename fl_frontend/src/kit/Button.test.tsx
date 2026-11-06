// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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

  const reason = () => screen.queryByRole("tooltip")?.textContent;
  const closed = () => waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());

  const lockedAct = (act: (typeof acts)[number]["act"], onPress?: () => void) => {
    render(
      <Button
        {...act}
        locked={REASON}
        onPress={onPress}
      />,
    );
    return screen.getByRole("button", { name: act.label });
  };

  // The harm: a native `disabled` takes the focus and the hover, and an icon's nested tooltip would show its name over
  // the reason, so the keys reach no reason.
  it.each(acts)("shows its reason on the keys' focus, a second Enter and Escape closing it on the button: $kind", async ({ act }) => {
    const onPress = vi.fn();
    const button = lockedAct(act, onPress);

    await userEvent.tab();
    expect(reason()).toBe(REASON);

    await userEvent.keyboard("{Enter}");
    expect(reason()).toBe(REASON);
    await userEvent.keyboard("{Enter}");
    await closed();

    await userEvent.keyboard("{Enter}");
    expect(reason()).toBe(REASON);
    await userEvent.keyboard("{Escape}");
    await closed();
    expect(document.activeElement).toBe(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  // The harm: a mouse raised the tooltip and the press took it away, so the click read as closing the reason.
  it("keeps the reason the pointer raised through a press, the next press closing it", async () => {
    const button = lockedAct(acts[0].act);

    // React Aria opens on a hover under the pointer's modality alone, which an earlier case's keys left.
    await userEvent.click(document.body);
    await userEvent.hover(button);
    expect((await screen.findByRole("tooltip")).textContent).toBe(REASON);

    await userEvent.click(button);
    expect(reason()).toBe(REASON);
    await userEvent.click(button);
    await closed();
  });

  it("opens the reason at once on a press the pointer's wait has not reached, and closes it on leaving", async () => {
    const button = lockedAct(acts[0].act);

    await userEvent.click(button);
    expect(reason()).toBe(REASON);

    await userEvent.unhover(button);
    await closed();
  });

  // The harm: a touch raises no tooltip of its own, so a phone reads no reason at all, and a tap has no leaving.
  it("opens the reason on a tap, a tap elsewhere closing it", async () => {
    const button = lockedAct(acts[0].act);

    await userEvent.pointer({ keys: "[TouchA]", target: button });
    expect(reason()).toBe(REASON);

    // The bare event: a tap on nothing need not move a phone's focus, where `userEvent` would blur the button.
    fireEvent.pointerDown(document.body, { pointerType: "touch", button: 0 });
    await closed();
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
    await screen.findByRole("tooltip");
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
