// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Sheet } from "./Sheet";

type Report = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;

// jsdom lays nothing out, so it scrolls nothing and sees nothing come into view, which is how React Aria's sheet knows
// it has slid in and out: the case below says what a browser would.
let inView: Report | undefined;

beforeEach(() => {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(report: Report) {
        inView = report;
      }
      observe(): void {}
      disconnect(): void {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a sheet", () => {
  // The harm: React Aria's own `SheetTrigger` takes the pressed mark off, so a press that opens a sheet leaves its
  // control looking untouched behind the scrim, which no check over the look reaches; and a trigger the kit assembles
  // itself must still open the sheet, close it and take the focus back, which nothing else here presses.
  it("keeps its trigger pressed while it stands, closes on Escape and hands the focus back", async () => {
    render(
      <Sheet
        label={COPY.template.more}
        trigger={
          <Button
            variant="secondary"
            label={COPY.template.more}
          />
        }>
        <Button
          variant="secondary"
          label={COPY.shared.filter}
        />
      </Sheet>,
    );
    const trigger = screen.getByRole("button", { name: COPY.template.more });
    expect(trigger.hasAttribute("data-pressed")).toBe(false);

    await userEvent.click(trigger);
    const scroller = await waitFor(() => {
      const found = document.querySelector("[data-sheet-scroll]");
      assert(found !== null, "the sheet did not open");
      return found;
    });
    // Slid in: it stands in view, and the slide has ended, on which the sheet takes the focus.
    act(() => {
      inView?.([{ isIntersecting: true, intersectionRatio: 1 }]);
      scroller.dispatchEvent(new Event("scrollend"));
    });

    const sheet = await screen.findByRole("dialog", { name: COPY.template.more });
    expect(within(sheet).getByRole("button", { name: COPY.shared.filter })).toBeTruthy();
    expect(trigger.hasAttribute("data-pressed")).toBe(true);
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));

    await userEvent.keyboard("{Escape}");
    expect(trigger.hasAttribute("data-pressed")).toBe(false);
    // Slid out of view.
    act(() => inView?.([{ isIntersecting: false, intersectionRatio: 0 }]));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  // The harm: `fl_frontend/patches/react-aria-components@1.22.1.patch` is what reads this frame, and a sheet it misses
  // stands off-screen and open over an inert page after a swipe, which no check over the source reaches.
  it("has entered once a frame touches the viewport's edge, so a swipe to the bottom closes it", async () => {
    render(
      <Sheet
        label={COPY.template.more}
        trigger={
          <Button
            variant="secondary"
            label={COPY.template.more}
          />
        }>
        <Button
          variant="secondary"
          label={COPY.shared.filter}
        />
      </Sheet>,
    );
    await userEvent.click(screen.getByRole("button", { name: COPY.template.more }));
    const scroller = await waitFor(() => {
      const found = document.querySelector("[data-sheet-scroll]");
      assert(found !== null, "the sheet did not open");
      return found;
    });
    // The one report of the rise: touching, so no area yet, and nothing more until the content is whole or gone.
    act(() => {
      inView?.([{ isIntersecting: true, intersectionRatio: 0 }]);
      scroller.dispatchEvent(new Event("scrollend"));
    });
    await screen.findByRole("dialog", { name: COPY.template.more });

    act(() => inView?.([{ isIntersecting: false, intersectionRatio: 0 }]));
    // jsdom's user agent names AppleWebKit and no Chrome, so React Aria takes it for desktop Safari, which waits for this.
    act(() => {
      scroller.dispatchEvent(new Event("scrollend"));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});
