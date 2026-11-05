// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CutText } from "./CutText";

/** jsdom lays nothing out, so each case gives the words the widths a browser would measure. */
function widths(element: HTMLElement, scrollWidth: number, clientWidth: number) {
  Object.defineProperty(element, "scrollWidth", { configurable: true, value: scrollWidth });
  Object.defineProperty(element, "clientWidth", { configurable: true, value: clientWidth });
}

// The tooltip is the browser's own, so nothing on the page shows a name repeated over itself, or a cut name
// left without its whole words, until somebody hovers it.
describe("cut words", () => {
  it("carry no tooltip while they stand whole", () => {
    render(
      <CutText
        text="Ahorn vs. Eiche"
        className="truncate"
      />,
    );
    const words = screen.getByText("Ahorn vs. Eiche");
    widths(words, 120, 120);
    fireEvent.pointerEnter(words);

    expect(words.hasAttribute("title")).toBe(false);
  });

  it("show their whole words in the tooltip once they are cut", () => {
    render(
      <CutText
        text="Carlo-Mierendorff-Schule"
        className="truncate"
      />,
    );
    const words = screen.getByText("Carlo-Mierendorff-Schule");
    widths(words, 180, 96);
    fireEvent.pointerEnter(words);

    expect(words.getAttribute("title")).toBe("Carlo-Mierendorff-Schule");
  });
});
