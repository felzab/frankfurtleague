// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Card, CardLink, CardRow } from "./Card";

describe("a card", () => {
  it("makes its title a heading, with its count beside it", () => {
    render(
      <Card
        title={COPY.shared.saison}
        count={3}
      />,
    );
    expect(screen.getByRole("heading", { name: COPY.shared.saison })).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("holds its records as rows, each one link through its name with its chip after the name", () => {
    render(
      <Card title={COPY.shared.saison}>
        <CardRow
          href="/saisons/2027"
          name="Helmholtzschule"
          chip={{ tone: "warn", label: COPY.shared.startelf }}
        />
      </Card>,
    );
    const link = screen.getByRole("link", { name: "Helmholtzschule" });
    expect(link.getAttribute("href")).toBe("/saisons/2027");
    // The name and its chip share one line, the chip after the name.
    const line = link.parentElement?.parentElement;
    expect(line?.lastElementChild?.textContent).toBe(COPY.shared.startelf);
    // The row ends in the chevron that says it leads on.
    expect(line?.parentElement?.lastElementChild?.querySelector("svg")).not.toBe(null);
  });

  it("makes a chooser's card one link, its title and line read as its name", () => {
    render(
      <CardLink
        href="/saisons/2027"
        title={COPY.shared.saison}
        lineText="Helmholtzschule"
      />,
    );
    expect(screen.getByRole("link").textContent).toBe(`${COPY.shared.saison}Helmholtzschule`);
    expect(screen.getByRole("link").querySelector("svg")).not.toBe(null);
  });
});
