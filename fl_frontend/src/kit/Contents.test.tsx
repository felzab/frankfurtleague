// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Prose } from "./Prose";

import type { ProseBlock } from "./Prose";

/** The sections' observer as the browser would run it: what it watches, and the report it hands on. */
let watched: Element[] = [];
let report: (entries: Array<Pick<IntersectionObserverEntry, "target" | "isIntersecting">>) => void = () => {};

class Watching {
  constructor(callback: typeof report) {
    report = callback;
  }
  observe(target: Element) {
    watched.push(target);
  }
  disconnect() {
    watched = [];
  }
}

afterEach(() => {
  watched = [];
  vi.unstubAllGlobals();
});

/** Two headings' words. */
const words = { a: COPY.template.liga, b: COPY.template.legal };

/** Three sections, the last two under one heading's words, as a sitemap's seasons could stand. */
const BLOCKS: ReadonlyArray<ProseBlock> = [
  { kind: "heading", text: words.a },
  { kind: "paragraph", text: [COPY.shared.help] },
  { kind: "heading", text: words.b },
  { kind: "paragraph", text: [COPY.shared.help] },
  { kind: "heading", text: words.b },
  { kind: "paragraph", text: [COPY.shared.help] },
];

const lists = () => screen.getAllByRole("navigation", { name: COPY.template.contents });

describe("a reading page's contents list", () => {
  // The harm: an entry whose section carries no such id, or a second section the first's, leads nowhere or to the
  // wrong section, which no type and no lint sees.
  it("leads each entry, beside the text and folded alike, to its own section", () => {
    vi.stubGlobal("IntersectionObserver", Watching);
    render(<Prose blocks={BLOCKS} />);

    for (const list of lists()) {
      const fragments = within(list)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href"));
      expect(new Set(fragments).size).toBe(3);
      for (const [index, fragment] of fragments.entries()) {
        const section = document.getElementById(fragment?.slice(1) ?? "");
        expect(section?.tagName).toBe("SECTION");
        expect(within(section as HTMLElement).getByRole("heading", { level: 2 }).textContent).toBe([words.a, words.b, words.b][index]);
      }
    }
  });

  // The harm: the mark standing on a section the reader has left, so the list tells them they are elsewhere.
  it("marks the topmost section showing under the band, and that one alone", async () => {
    vi.stubGlobal("IntersectionObserver", Watching);
    render(<Prose blocks={BLOCKS} />);
    const [first, second, third] = watched;
    const marked = () =>
      lists()
        .flatMap((list) => within(list).getAllByRole("link"))
        .filter((link) => link.getAttribute("aria-current") === "location")
        .map((link) => link.getAttribute("href"));

    expect(marked()).toStrictEqual([`#${first?.id ?? ""}`]);

    await act(async () => {
      report([
        { target: first as Element, isIntersecting: false },
        { target: second as Element, isIntersecting: true },
        { target: third as Element, isIntersecting: true },
      ]);
    });
    expect(marked()).toStrictEqual([`#${second?.id ?? ""}`]);

    await act(async () => {
      report([{ target: second as Element, isIntersecting: false }]);
    });
    expect(marked()).toStrictEqual([`#${third?.id ?? ""}`]);
  });
});
