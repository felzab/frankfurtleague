// @vitest-environment jsdom
import { wholeText } from "@/test-support/wholeText";
import { fireEvent, render, screen } from "@testing-library/react";
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
    const nameLine = screen.getByText(COPY.admin.expired).parentElement;
    expect(nameLine?.textContent).toBe(`anna@example.org${COPY.admin.expired}${COPY.admin.delivery.undeliverable}`);
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
    const nameLine = screen.getByText("Lea Bauer").parentElement?.parentElement;
    expect(nameLine?.textContent).toBe(`Lea Bauer${COPY.shared.bank}${WORDS.rolleOption.kapitaen}${WORDS.nominee}`);
    expect(screen.getByText(COPY.shared.bank).getAttribute("aria-hidden")).toBe("true");
  });

  // The harm: a row with acts sets its chips before the name, or loses the muted line under it. Where its parts stand on
  // the screen is the drive's to measure: jsdom lays nothing out.
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

  it.each([
    ["a short name and its chip", "Anna Berg", false],
    ["a long name and its chip", "Annemarie Konstanze Berg-Wolkenstein von Hohenlimburg", false],
    ["a name and two chips", "Anna Berg", true],
    // A club's name may hold an „@“ and a „.“, and is cut as every name is: only a row its list marks is an address.
    ["a club's name holding an „@“", "Team @ Goethe.Schule", false],
  ])("sets %s in a row with acts, the name first and the muted line under it", (_case, name, delivered) => {
    render(actRow(name, delivered));
    const nameLine = screen.getByText(name).parentElement?.parentElement;
    expect(nameLine?.textContent).toBe(`${name}${COPY.admin.expired}${delivered ? COPY.admin.delivery.undeliverable : ""}`);
    expect(nameLine?.nextElementSibling?.textContent).toBe("Neuer Administrator");
  });

  // The harm: two rows told apart by their addresses alone read alike once both are cut, and a touch reaches no tooltip.
  // The layout is the phone journey's (`e2e/phone/access.spec.ts`); this holds where a line may break: after the „@“, and
  // before a „.“ inside a part, never between „example“ and „.com“ unless the part itself is wider than its line.
  it("breaks an address after its „@“ first, its chip after it", () => {
    const address = "gesperrte.person@example.com";
    render(actRow(address, false, true));
    const words = screen.getByText(wholeText(address));
    expect(words.innerHTML.replaceAll(/ class="[^"]*"/gu, "")).toBe("<span>gesperrte<wbr>.person@</span><wbr><span>example<wbr>.com</span>");
    expect(words.parentElement?.parentElement?.textContent).toBe(`${address}${COPY.admin.expired}`);
  });

  // The harm: on a row that opens a page, its name's link stretches over the whole row, so the pointer never reaches a
  // cut cell's words and their whole never shows. jsdom lays nothing out, so the cell's box and its cut are given by hand.
  it("shows a cut cell's whole words under the pointer on a row whose link stretches over it", () => {
    const address = "schiedsrichterin.mit.einer.sehr.langen.adresse@example.com";
    render(
      <Table
        {...props([{ id: "1", name: { record: "Elif Engin" }, href: "/admin/schiedsrichter", cells: { email: { record: address } } }])}
        columns={[{ key: "email", label: COPY.signIn.address, width: "line", cut: true }]}
      />,
    );
    const cell = screen.getByText(address);
    Object.defineProperties(cell, { scrollWidth: { value: 631 }, clientWidth: { value: 264 } });
    cell.getBoundingClientRect = () => new DOMRect(500, 100, 264, 20);
    const link = screen.getByRole("link", { name: "Elif Engin" });
    const host = link.parentElement;
    fireEvent.pointerMove(link, { clientX: 600, clientY: 110 });
    expect(host?.getAttribute("title")).toBe(address);
    // Past the cell, over a part of the row holding nothing cut, no tooltip stands.
    fireEvent.pointerMove(link, { clientX: 900, clientY: 110 });
    expect(host?.hasAttribute("title")).toBe(false);
  });

  // The harm: a phone row loses a player's position and Stufe, which only its desktop columns hold.
  it("sets a phone's line under the name", () => {
    render(
      <Table
        {...props([{ id: "1", name: { record: "Lea Bauer" }, phoneLine: { record: "Abwehr · Q2" }, cells: {} }])}
        columns={[{ key: "position", label: COPY.admin.spieler.position, hideOnPhone: true }]}
      />,
    );
    const line = screen.getByText("Lea Bauer").parentElement?.parentElement?.nextElementSibling;
    expect(line?.textContent).toBe("Abwehr · Q2");
  });
});
