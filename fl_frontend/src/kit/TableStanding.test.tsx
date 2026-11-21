// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy/shared";

import { TableStanding } from "./TableStanding";

import type { TableStandingRow } from "./TableStanding";

/** A club at the place a case gives it. */
const club = (id: string, name: string, place: number | null): TableStandingRow => ({
  id,
  name: { record: name },
  plaque: { record: name.slice(0, 3).toUpperCase() },
  href: "/",
  place,
  cells: { punkte: { record: "0" } },
});

describe("a standing's rank column", () => {
  // The Tabelle's places are the backend's: level clubs share one, and a club that has played no match holds
  // none and stands last. A table counting its rows would number them 1, 2, 3, 4 whatever the standing says.
  it("shows each row's own place, a shared one twice, and a dash for a row holding none", () => {
    render(
      <TableStanding
        label={COPY.shared.saison}
        rankLabel={COPY.shared.saison}
        nameLabel={COPY.shared.saison}
        columns={[{ key: "punkte", label: COPY.shared.startelf }]}
        rows={[club("1", "Goethe", 1), club("2", "Bettina", 1), club("3", "Schiller", 3), club("4", "Lessing", null)]}
        empty={{ kind: "none", plural: COPY.shared.startelf }}
      />,
    );
    const ranks = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => row.firstElementChild?.textContent);
    expect(ranks).toStrictEqual(["1.", "1.", "3.", "–"]);
  });
});
