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
  it("navigates on the client through Next's link", () => {
    render(
      <Link
        href={SPIEL}
        placement="standalone"
        label={COPY.shared.zumSpiel}
      />,
    );

    const link = screen.getByRole("link", { name: COPY.shared.zumSpiel });
    expect(link.hasAttribute("data-client-navigation")).toBe(true);
  });

  it("with `fullPage`, is a plain anchor loading the target as a whole document", () => {
    render(
      <Link
        href={SPIEL}
        placement="standalone"
        fullPage
        label={COPY.shared.zumSpiel}
      />,
    );

    const link = screen.getByRole("link", { name: COPY.shared.zumSpiel });
    expect(link.hasAttribute("data-client-navigation")).toBe(false);
    expect(link.getAttribute("href")).toBe(SPIEL);
    expect(link.getAttribute("data-kit-focus")).toBe("ring");
  });
});
