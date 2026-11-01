// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SponsorTiles } from "./TileGrid";

const SPTG = { name: "Stiftung Polytechnische Gesellschaft", short: "SPTG", logo: "/icons/sponsors/sptg.svg", href: "https://www.sptg.de/" };

describe("a sponsor's tile", () => {
  // Nothing on screen shows the link's mark: it says to a search engine that the link is a sponsor's.
  it("links to the sponsor's site marked sponsored, named by the full name, its short name shown", () => {
    render(<SponsorTiles sponsors={[SPTG]} />);
    const link = screen.getByRole("link", { name: SPTG.name });
    expect(link.getAttribute("href")).toBe(SPTG.href);
    expect(link.getAttribute("rel")?.split(" ")).toContain("sponsored");
    expect(link.getAttribute("title")).toBe(SPTG.name);
    expect(link.textContent).toBe(SPTG.short);
    // The logo is the one image, with no glyph saying the link leaves the site.
    expect(link.querySelectorAll("svg")).toHaveLength(0);
  });
});
