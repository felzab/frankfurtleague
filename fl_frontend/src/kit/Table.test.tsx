// @vitest-environment jsdom
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
  it("sets the line under the name, and the delivery's chip after the state's", () => {
    render(
      <Table
        {...props([
          {
            id: "1",
            name: { record: "anna@example.org" },
            chip: { tone: "warn", label: COPY.admin.expired },
            delivery: { tone: "danger", label: COPY.admin.delivery.undeliverable },
            line: { record: "Neuer Administrator" },
            cells: {},
          },
        ])}
      />,
    );
    const nameLine = screen.getByText(COPY.admin.expired).parentElement?.parentElement;
    expect(nameLine?.textContent).toContain(COPY.admin.delivery.undeliverable);
    expect(nameLine?.nextElementSibling?.textContent).toBe("Neuer Administrator");
  });

  // The harm: a captain's mark after the chip, read as part of the state, or drawn as a bare letter a screen reader
  // spells out with nothing saying what it stands for.
  it("sets a player's mark directly after the name and before the chip, named by its role", () => {
    const WORDS = COPY.admin.spieler;
    render(
      <Table
        {...props([
          {
            id: "1",
            name: { record: "Lea Bauer" },
            // Any of the catalogue's words stands for the letters here: the mark draws what its page hands it.
            mark: { letters: COPY.shared.bank, label: WORDS.rolleOption.kapitaen },
            chip: { tone: "info", label: WORDS.nominee },
            cells: {},
          },
        ])}
      />,
    );
    const nameLine = screen.getByText("Lea Bauer").parentElement;
    expect(nameLine?.textContent).toBe(`Lea Bauer${COPY.shared.bank}${WORDS.rolleOption.kapitaen}${WORDS.nominee}`);
    expect(screen.getByText(COPY.shared.bank).getAttribute("aria-hidden")).toBe("true");
  });

  // The harm: on a phone a row with acts drops its chip to a line of its own or wraps a long name over several, where
  // every other list cuts the name with „…“ and keeps the chip beside it. jsdom lays nothing out, so each case holds what
  // the cut rests on: one line holding the name and then its chips in tracks of their own size, the name's track
  // shrinking to nothing, and the name cut at every width.
  it.each([
    ["a short name and its chip", "anna@example.org", false],
    ["a long name and its chip", "gesperrte.person.mit.langer.adresse@example.com", false],
    ["a name and two chips", "anna@example.org", true],
  ])("sets %s on one line of a row with acts, the name first and cut on a phone too", (_case, name, delivered) => {
    render(
      <Table
        {...props([
          {
            id: "1",
            name: { record: name },
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
      />,
    );
    const words = screen.getByText(name);
    const nameLine = words.parentElement;
    expect(nameLine?.textContent).toBe(`${name}${COPY.admin.expired}${delivered ? COPY.admin.delivery.undeliverable : ""}`);
    expect(nameLine?.className.split(" ")).toContain("grid-cols-[minmax(0,max-content)]");
    expect(nameLine?.className.split(" ")).not.toContain("max-lg:flex-wrap");
    expect(words.className.split(" ")).toContain("truncate");
    expect(words.className.split(" ")).not.toContain("max-lg:whitespace-normal");
    expect(nameLine?.nextElementSibling?.textContent).toBe("Neuer Administrator");
  });

  // The harm: a phone row loses a player's position and Stufe, which only its desktop columns hold, or a desktop row
  // says them twice, in the line and in the columns.
  it("sets a phone's line under the name and leaves it out from `lg`, where the columns say it", () => {
    render(
      <Table
        {...props([{ id: "1", name: { record: "Lea Bauer" }, phoneLine: { record: "Abwehr · Q2" }, cells: {} }])}
        columns={[{ key: "position", label: COPY.admin.spieler.position, hideOnPhone: true }]}
      />,
    );
    const line = screen.getByText("Lea Bauer").parentElement?.nextElementSibling;
    expect(line?.textContent).toBe("Abwehr · Q2");
    expect(line?.className.split(" ")).toContain("lg:hidden");
  });
});
