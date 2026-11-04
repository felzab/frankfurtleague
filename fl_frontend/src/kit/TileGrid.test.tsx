// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SponsorTiles } from "./TileGrid";

const NAME = "Stiftung Polytechnische Gesellschaft";
const SPTG = { name: { record: NAME }, short: { record: "SPTG" }, logo: "/icons/sponsors/sptg.svg", href: "https://www.sptg.de/" };

describe("a sponsor's tile", () => {
  // Nothing on screen shows the link's mark: it says to a search engine that the link is a sponsor's.
  it("links to the sponsor's site in a new tab marked sponsored, named by the full name, its short name shown", () => {
    render(<SponsorTiles sponsors={[SPTG]} />);
    const link = screen.getByRole("link", { name: NAME });
    expect(link.getAttribute("href")).toBe(SPTG.href);
    expect(link.getAttribute("rel")?.split(" ")).toContain("sponsored");
    expect(link.getAttribute("target")).toBe("_blank");
    // The full name shows under the pointer over the whole tile, which the link's content fills.
    expect(link.firstElementChild?.getAttribute("title")).toBe(NAME);
    expect(link.textContent).toBe(SPTG.short.record);
    // The logo is the one image, with no glyph saying the link leaves the site.
    expect(link.querySelectorAll("svg")).toHaveLength(0);
  });
});
