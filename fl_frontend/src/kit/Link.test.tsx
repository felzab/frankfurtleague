// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";

import { Link } from "./Link";

import type { ComponentProps } from "react";

// Next's link, standing in as an anchor that says it navigates on the client: a client navigation is what an
// intercepting route catches.
vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => (
    <a
      data-client-navigation
      {...props}>
      {children}
    </a>
  ),
}));

const SPIEL = "/saisons/2027/spiele/64b000000000000000000001";

describe("the kit's link", () => {
  it("opens another site's address in a new tab with no way back to the opener, in every placement", () => {
    render(
      <>
        <Link
          href="https://www.instagram.com/frankfurtleague"
          placement="icon"
          icon="instagram"
          label={COPY.template.instagram}
        />
        <Link
          href="https://www.threads.net/@frankfurtleague"
          placement="footer"
          label={COPY.template.threads}
        />
      </>,
    );

    for (const name of [COPY.template.instagram, COPY.template.threads]) {
      const link = screen.getByRole("link", { name });
      expect(link.getAttribute("target")).toBe("_blank");
      expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    }
  });

  it("opens a page of the site and a mail address in place", () => {
    render(
      <>
        <Link
          href={SPIEL}
          placement="standalone"
          label={COPY.shared.toSpiel}
        />
        <Link
          href="mailto:kontakt@frankfurtleague.de"
          placement="footer"
          label={{ record: "kontakt@frankfurtleague.de" }}
        />
      </>,
    );

    for (const link of screen.getAllByRole("link")) {
      expect(link.getAttribute("target")).toBeNull();
      expect(link.getAttribute("rel")).toBeNull();
    }
  });

  it("marks a sponsor's site paid, and still opens it in a new tab", () => {
    render(
      <Link
        href="https://www.example.com"
        placement="card"
        sponsored>
        Sponsor
      </Link>,
    );

    const link = screen.getByRole("link", { name: "Sponsor" });
    expect(link.getAttribute("rel")).toBe("sponsored noopener noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("with `fullPage`, is a plain anchor loading the target as a whole document", () => {
    render(
      <Link
        href={SPIEL}
        placement="standalone"
        fullPage
        label={COPY.shared.toSpiel}
      />,
    );

    const link = screen.getByRole("link", { name: COPY.shared.toSpiel });
    expect(link.hasAttribute("data-client-navigation")).toBe(false);
    expect(link.getAttribute("href")).toBe(SPIEL);
    expect(link.getAttribute("data-kit-focus")).toBe("ring");
  });

  // The harm: under the pointer the struck name loses its strike, so a no-show reads as a player who turned up, and only
  // an eye over a hovered name sees it.
  it("keeps a struck name's strike beside the pointer's underline", () => {
    render(
      <Link
        href={SPIEL}
        placement="struck"
        label={COPY.shared.toSpiel}
      />,
    );

    const classes = screen.getByRole("link", { name: COPY.shared.toSpiel }).className.split(" ");
    expect(classes).toContain("line-through");
    const decorated = classes.filter((name) => /^(?:hover|active):.*(?:underline|text-decoration)/.test(name));
    expect(decorated.length).toBeGreaterThan(0);
    for (const name of decorated) expect(name).toContain("line-through");
  });
});
