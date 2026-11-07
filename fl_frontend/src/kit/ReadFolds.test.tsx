// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { OpenFoldPlaceholder, ReadFolds } from "./ReadFolds";

import type { TableProps } from "./Table";

const TABLE: TableProps = {
  label: COPY.shared.saison,
  nameLabel: COPY.shared.name,
  columns: [],
  rows: [{ id: "1", name: { record: "anna@example.org" }, cells: {} }],
  empty: { kind: "none", plural: COPY.shared.saison },
};

const OPEN = { title: { record: "Aktiv" }, tables: [TABLE], open: true } as const;
const FOLDED = { title: { record: "Angekündigt" }, tables: [TABLE] } as const;

describe("a page's folded cards", () => {
  // The harm: Administratoren's list of who holds access would start closed, or its waits open, both reading as a page.
  it("starts open only the card that says so", () => {
    render(
      <ReadFolds
        cards={[OPEN, FOLDED]}
        column
      />,
    );
    expect(screen.getByRole("button", { name: "Aktiv" }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Angekündigt" }).getAttribute("aria-expanded")).toBe("false");
  });

  // „Angekündigt“ stands below „Aktiv“ at every width: side by side a closed card would leave half the row empty.
  it("sets a column's cards one under another, where a read page sets two side by side", () => {
    const { container, rerender } = render(<ReadFolds cards={[OPEN, FOLDED]} />);
    expect(container.firstElementChild?.className).toContain("lg:grid-cols-2");
    rerender(
      <ReadFolds
        cards={[OPEN, FOLDED]}
        column
      />,
    );
    expect(container.firstElementChild?.className).not.toContain("lg:grid-cols-2");
  });
});

describe("an open card's wait", () => {
  // The harm: a chevron pointing elsewhere, or none, moves the title and turns as the card lands.
  it("names its card, turns its chevron as the open card's, and draws its table's rows", () => {
    const { container } = render(
      <OpenFoldPlaceholder
        title={COPY.admin.team.active}
        head={{ nameLabel: COPY.shared.name, columns: [] }}
        rows={3}
      />,
    );
    expect(screen.getByText(COPY.admin.team.active)).toBeTruthy();
    expect(container.querySelector("svg")?.parentElement?.classList.contains("rotate-90")).toBe(true);
    expect(container.querySelectorAll("tbody tr")).toHaveLength(3);
  });
});
