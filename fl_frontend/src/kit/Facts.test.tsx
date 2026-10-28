// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Facts } from "./Facts";

describe("a fact's link", () => {
  it("opens another site in a new tab, and a page of the site in place", () => {
    render(
      <Facts
        facts={[
          {
            label: COPY.spielplan.fakt.ort,
            elsewhere: { href: "https://www.google.com/maps/search/?api=1&query=Ahornweg", text: "Sportplatz Ahornweg" },
          },
          { label: COPY.spielplan.fakt.spieltag, link: { href: "/saisons/2027", text: "1. Spieltag" } },
        ]}
      />,
    );

    const elsewhere = screen.getByRole("link", { name: "Sportplatz Ahornweg" });
    expect(elsewhere.getAttribute("target")).toBe("_blank");
    expect(elsewhere.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: "1. Spieltag" }).getAttribute("target")).toBeNull();
  });
});

describe("a fact's glyph", () => {
  it("leads the label on its line and is hidden from assistive technology", () => {
    render(
      <Facts
        look="free"
        facts={[{ label: COPY.spielplan.fakt.datum, glyph: "kalender", value: "14.03.2027", figures: true }]}
      />,
    );

    const term = screen.getByText(COPY.spielplan.fakt.datum);
    const glyph = term.querySelector("svg");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(term.textContent).toBe(COPY.spielplan.fakt.datum);
  });
});
