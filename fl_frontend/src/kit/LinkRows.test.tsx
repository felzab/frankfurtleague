// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { COPY } from "@/core/copy";
import { SERVER_COPY } from "@/core/serverCopy";

import { LinkRows } from "./LinkRows";

import type { ComponentProps } from "react";

vi.mock("next/link", () => ({
  default: ({ children, ...props }: ComponentProps<"a">) => <a {...props}>{children}</a>,
}));

describe("the ways to reach the league", () => {
  it("opens a profile on another site in a new tab, and the mail address in place", () => {
    render(
      <LinkRows
        rows={[
          { label: SERVER_COPY.landing.contact.email, value: "info@example.org", href: "mailto:info@example.org" },
          { glyph: "instagram", label: COPY.template.instagram, value: "@frankfurtleague", href: "https://www.instagram.com/frankfurtleague" },
        ]}
      />,
    );

    const profile = screen.getByRole("link", { name: COPY.template.instagram });
    expect(profile.getAttribute("target")).toBe("_blank");
    expect(profile.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: SERVER_COPY.landing.contact.email }).hasAttribute("target")).toBe(false);
  });
});
