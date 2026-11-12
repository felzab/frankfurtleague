// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { ReadingPage } from "./Prose";

import type { ProseSection } from "./Prose";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Two headings' words. */
const words = { a: COPY.template.liga, b: COPY.template.legal };

/** Three sections, the last two under one heading's words, as a sitemap's seasons could stand. */
const SECTIONS: ReadonlyArray<ProseSection> = [
  { heading: words.a, blocks: [{ kind: "paragraph", text: [COPY.shared.help] }] },
  { heading: words.b, blocks: [{ kind: "paragraph", text: [COPY.shared.help] }] },
  { heading: words.b, blocks: [{ kind: "paragraph", text: [COPY.shared.help] }] },
];

/** The band's height, which each section's scroll margin carries. */
const BAND = 56;

const lists = () => screen.getAllByRole("navigation", { name: COPY.template.contents });

/** The page laid out as a browser would: the sections' tops under the screen's top, and whether it stands at its end. */
function scrolled(tops: readonly number[], end: boolean) {
  const sections = [...document.querySelectorAll("section")];
  for (const [index, section] of sections.entries()) {
    section.style.scrollMarginTop = `${String(BAND)}px`;
    section.getBoundingClientRect = () => ({ top: tops[index] ?? 0 }) as DOMRect;
  }
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("scrollY", end ? 1200 : 600);
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 2000 });
  act(() => {
    dispatchEvent(new Event("scroll"));
  });
}

/** The sections each list marks, by their place in the text. */
function marked() {
  const ids = [...document.querySelectorAll("section")].map((section) => `#${section.id}`);
  return lists().map((list) =>
    within(list)
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "location")
      .map((link) => ids.indexOf(link.getAttribute("href") ?? "")),
  );
}

describe("a reading page's contents list", () => {
  // The harm: an entry whose section carries no such id, or a second section the first's, leads nowhere or to the
  // wrong section, which no type and no lint sees.
  it("leads each entry, beside the text and folded alike, to its own section", () => {
    render(
      <ReadingPage
        title={words.a}
        lead={[]}
        sections={SECTIONS}
      />,
    );

    for (const list of lists()) {
      const fragments = within(list)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));
      expect(new Set(fragments).size).toBe(3);
      for (const [index, fragment] of fragments.entries()) {
        const section = document.getElementById(fragment?.slice(1) ?? "");
        expect(section?.tagName).toBe("SECTION");
        expect(within(section as HTMLElement).getByRole("heading", { level: 2 }).textContent).toBe(SECTIONS[index]?.heading);
      }
    }
  });

  // The harm: a last section too short to reach the band is never marked, so the list never names where the reader is.
  it("marks the last section the band has reached, and at the page's end the last", () => {
    render(
      <ReadingPage
        title={words.a}
        lead={[]}
        sections={SECTIONS}
      />,
    );

    scrolled([-300, BAND - 20, 300], false);
    expect(marked()).toStrictEqual([[1], [1]]);

    scrolled([-500, -100, 300], true);
    expect(marked()).toStrictEqual([[2], [2]]);
  });

  // The harm: an entry the page's end keeps from the band would show the click as going nowhere.
  it("marks the entry clicked at once, and holds it until the reader scrolls it off", () => {
    render(
      <ReadingPage
        title={words.a}
        lead={[]}
        sections={SECTIONS}
      />,
    );
    scrolled([-300, 200, 400], true);
    expect(marked()).toStrictEqual([[2], [2]]);

    const [, entry] = within(lists()[0] as HTMLElement).getAllByRole("link");
    act(() => {
      fireEvent.click(entry as HTMLElement);
    });
    expect(marked()).toStrictEqual([[1], [1]]);

    // The jump's own scroll, which the page's end stops short of the band.
    scrolled([-300, 200, 400], true);
    expect(marked()).toStrictEqual([[1], [1]]);

    // The reader scrolls up, off the page's end.
    scrolled([BAND, 400, 600], false);
    expect(marked()).toStrictEqual([[0], [0]]);
  });
});
