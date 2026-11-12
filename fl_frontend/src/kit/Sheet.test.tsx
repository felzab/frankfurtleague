// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
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
