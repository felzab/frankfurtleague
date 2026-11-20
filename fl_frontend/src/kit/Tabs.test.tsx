// @vitest-environment jsdom
import { screen } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import { COPY } from "@/core/copy/shared";
import { renderUnderNext } from "@/test-support/nextContexts";

import { Tabs } from "./Tabs";

/** A season's nine matchdays, the last chosen. */
const SPIELTAGE = Array.from({ length: 9 }, (_, index) => ({ id: String(index + 1), label: COPY.shared.spieltag(index + 1) }));

/**
 * jsdom lays nothing out: the row is a phone's 360 px wide at the left of the screen, and the chosen tab stands 240 px
 * past its end, where a phone would draw it out of sight.
 */
function layOut() {
  const box = (left: number, right: number) => ({ left, right, top: 0, bottom: 40, width: right - left, height: 40, x: left, y: 0 });
  const laid = vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.tagName === "UL") return box(0, 360) as DOMRect;
    if (this.getAttribute("aria-current") === "page") return box(500, 600) as DOMRect;
    return box(0, 0) as DOMRect;
  });
  onTestFinished(() => laid.mockRestore());
}

describe("the tab row", () => {
  // A chosen tab out of sight leaves a phone's reader guessing which matchday the list below shows, and only a look
  // at a phone's width sees it.
  it("scrolls the row alone, by as little as brings the chosen tab in, and never the page", async () => {
    layOut();
    const rowScrolled = vi.spyOn(Element.prototype, "scrollTo");
    // jsdom has neither, so each is a stand-in here, recording a scroll that would move the page.
    const pageScrolled = vi.fn();
    const viewScrolled = vi.fn();
    vi.stubGlobal("scrollTo", pageScrolled);
    Object.assign(Element.prototype, { scrollIntoView: viewScrolled });
    onTestFinished(() => {
      rowScrolled.mockRestore();
      vi.unstubAllGlobals();
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    });

    renderUnderNext(
      <Tabs
        label={COPY.spielplan.spieltage}
        selectedKey="9"
        tabs={SPIELTAGE}>
        <p>Spiele</p>
      </Tabs>,
      { pathname: "/saisons/2027" },
    );

    expect(rowScrolled).toHaveBeenCalledTimes(1);
    expect(rowScrolled.mock.contexts[0]).toBe((await screen.findByRole("navigation")).querySelector("ul"));
    expect(rowScrolled.mock.calls[0]).toEqual([{ left: 240 }]);
    expect(pageScrolled).not.toHaveBeenCalled();
    expect(viewScrolled).not.toHaveBeenCalled();
  });
});
