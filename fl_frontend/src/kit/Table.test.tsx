// @vitest-environment jsdom
import { wholeText } from "@/test-support/wholeText";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { Button } from "./Button";
import { Table } from "./Table";

import type { TableProps } from "./Table";

const props = (rows: TableProps["rows"]): TableProps => ({
  label: COPY.shared.saison,
  nameLabel: COPY.shared.saison,
  columns: [{ key: "district", label: COPY.shared.startelf }],
  rows,
  empty: { kind: "none", plural: COPY.shared.startelf },
});

describe("a table's rank column", () => {
  // The Tabelle's places are the backend's: level clubs share one, and a club that has played no match holds
  // none and stands last. A table counting its rows would number them 1, 2, 3, 4 whatever the standing says.
  it("shows each row's own place, a shared one twice, and a dash for a row holding none", () => {
    render(
      <Table
        {...props([
          { id: "1", name: { record: "Goethe" }, place: 1, cells: { district: { record: "Nordend" } } },
          { id: "2", name: { record: "Bettina" }, place: 1, cells: { district: { record: "Westend" } } },
          { id: "3", name: { record: "Schiller" }, place: 3, cells: { district: { record: "Bornheim" } } },
          { id: "4", name: { record: "Lessing" }, place: null, cells: { district: { record: "Ostend" } } },
        ])}
        rankLabel={COPY.shared.saison}
      />,
    );
    const ranks = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.firstElementChild?.textContent);
    expect(ranks).toStrictEqual(["1", "1", "3", "–"]);
  });
});

describe("a row's name cell", () => {
  /** A row with acts: its chip, the delivery's where `delivered`, and the muted line under its name. */
  const actRow = (name: string, delivered: boolean, address = false) => (
    <Table
      {...props([
        {
          id: "1",
          name: address ? { record: name, address: true as const } : { record: name },
          chip: { tone: "warn", label: COPY.admin.expired },
          ...(delivered ? { delivery: { tone: "danger" as const, label: COPY.admin.delivery.undeliverable } } : {}),
          line: { record: "Neuer Administrator" },
          cells: {},
          acts: (
            <Button
              variant="secondary"
              label={COPY.shared.verb.remove}
            />
          ),
        },
      ])}
    />
  );

  // The harm: two rows told apart by their addresses alone read alike once both are cut, and a touch reaches no tooltip.
  // The layout is the phone journey's (`e2e/phone/access.spec.ts`); this holds where a line may break: after the „@“, and
  // before a „.“ inside a part, never between „example“ and „.com“ unless the part itself is wider than its line.
  it("breaks an address after its „@“ first, its chip after it", () => {
    const address = "gesperrte.person@example.com";
    render(actRow(address, false, true));
    const words = screen.getByText(wholeText(address));
    expect(words.innerHTML.replaceAll(/ class="[^"]*"/gu, "")).toBe("<span>gesperrte<wbr>.person@</span><wbr><span>example<wbr>.com</span>");
    expect(words.closest('[role="cell"]')?.firstElementChild?.textContent).toBe(`${address}${COPY.admin.expired}`);
  });
});
