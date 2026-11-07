// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ReadFolds } from "./ReadFolds";

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
});
