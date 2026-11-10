// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { EmptyState } from "./EmptyState";

import type { Route } from "next";

const ADDRESS = "kontakt@example.com";

describe("an empty list's line", () => {
  // The harm: a team with no registration yet learns nothing of where the link comes from, the link's words run into
  // the sentence around them, or the address leads nowhere.
  it("sets the catalogue's words around its one link, under the sentence", () => {
    const line = COPY.area.team.registrierung.linkFromLeague;
    render(
      <EmptyState
        kind="none"
        plural={COPY.page.registrierungen}
        line={{ ...line, link: { href: `mailto:${ADDRESS}` as Route, label: { record: ADDRESS } } }}
      />,
    );

    const link = screen.getByRole("link", { name: ADDRESS });
    expect(link.getAttribute("href")).toBe(`mailto:${ADDRESS}`);
    expect(link.parentElement?.textContent).toBe(`${line.before}${ADDRESS}${line.after}`);
    expect(link.parentElement?.previousElementSibling?.textContent).toBe(COPY.shared.empty.none(COPY.page.registrierungen));
  });
});
