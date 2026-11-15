// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";

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

  // The harm: a touch raises no tooltip of its own, so a phone reads no reason at all, and a tap has no leaving.
  it("opens the reason on a tap, a tap elsewhere closing it", async () => {
    const button = lockedAct(acts[0].act);

    await userEvent.pointer({ keys: "[TouchA]", target: button });
    expect(reason()).toBe(REASON);

    // The bare event: a tap on nothing need not move a phone's focus, where `userEvent` would blur the button.
    fireEvent.pointerDown(document.body, { pointerType: "touch", button: 0 });
    await closed();
  });
});
