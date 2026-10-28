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
