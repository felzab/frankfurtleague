// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { SpielGroup } from "./SpielGroup";

const MATCHDAY = COPY.shared.spieltag(2);
const SPIEL = {
  id: "64b000000000000000000001",
  href: "/saisons/2027/spiele/64b000000000000000000001",
  when: COPY.spielplan.when("2027-03-13", "18:00"),
  team1: { name: { record: "Ahorn" }, plaque: { record: "AHO" } },
  team2: { name: { record: "Kastanie" }, plaque: { record: "KAS" } },
} as const;

describe("a match under its head", () => {
  // The owner's ruling on the Spiele row: the matchday heads its match and never joins the row's date line.
  it("heads its match's row with its own heading, apart from the row's words", () => {
    render(
      <SpielGroup
        head={MATCHDAY}
        spiel={SPIEL}
      />,
    );
    const head = screen.getByRole("heading", { level: 3, name: MATCHDAY });
    const group = head.parentElement;
    if (group === null) throw new Error("the head stands in no group");
    const row = within(group).getByRole("link");
    expect(head.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.textContent).not.toContain(MATCHDAY);
  });
});
