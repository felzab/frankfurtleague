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
            label: COPY.spielplan.fact.spielort,
            elsewhere: { href: "https://www.google.com/maps/search/?api=1&query=Ahornweg", text: "Sportplatz Ahornweg" },
          },
          { label: COPY.spielplan.fact.spieltag, link: { href: "/saisons/2027", text: "1. Spieltag" } },
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
        facts={[{ label: COPY.spielplan.fact.datum, glyph: "calendar", value: "14.03.2027", figures: true }]}
      />,
    );

    const term = screen.getByText(COPY.spielplan.fact.datum);
    const glyph = term.querySelector("svg");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(term.textContent).toBe(COPY.spielplan.fact.datum);
  });
});

describe("a record's subject line", () => {
  // jsdom lays nothing out: the name takes Tailwind's `truncate`, and the chip, its sibling, keeps its size.
  it("cuts a long name with „…“, whole in its title, and keeps the chip on its line", () => {
    const name = "Sportanlage an der Bertha-von-Suttner-Schule Mitte";
    render(
      <Facts
        subject={{ name, chip: { tone: "neutral", label: COPY.verwaltung.spielort.retired } }}
        facts={[]}
      />,
    );

    const subject = screen.getByTitle(name);
    expect(subject.classList).toContain("truncate");
    const chip = screen.getByText(COPY.verwaltung.spielort.retired);
    expect(chip.parentElement).toBe(subject.parentElement);
    expect(chip.classList).toContain("shrink-0");
  });
});
