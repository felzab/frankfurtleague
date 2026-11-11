// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { INSTAGRAM_URL } from "@/core/brand";
import { COPY } from "@/core/copy";

import { LinkRows } from "./LinkRows";

describe("a way's row", () => {
  // The harm: the row's link stretches over the whole row, so the pointer never reaches the cut address beside it and
  // its whole never shows. jsdom lays nothing out, so the address's box and its cut are given by hand.
  it("shows the cut address's whole words under the pointer", () => {
    const handle = "frankfurt.league.mit.einem.sehr.langen.namen";
    render(<LinkRows rows={[{ glyph: "instagram", label: COPY.template.instagram, value: { record: handle }, href: INSTAGRAM_URL }]} />);
    const value = screen.getByText(handle);
    Object.defineProperties(value, { scrollWidth: { value: 320 }, clientWidth: { value: 140 } });
    value.getBoundingClientRect = () => new DOMRect(180, 10, 140, 20);
    const link = screen.getByRole("link", { name: COPY.template.instagram });
    const host = link.parentElement;
    fireEvent.pointerMove(link, { clientX: 250, clientY: 20 });
    expect(host?.getAttribute("title")).toBe(handle);
    // Over the way's own name, which is whole, no tooltip stands.
    fireEvent.pointerMove(link, { clientX: 40, clientY: 20 });
    expect(host?.hasAttribute("title")).toBe(false);
  });
});
