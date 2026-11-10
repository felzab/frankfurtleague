// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ScoreRows } from "./ScoreRows";

const SIDES = [
  { name: { record: "Ahorn" }, plaque: { record: "AHO" } },
  { name: { record: "Kastanie" }, plaque: { record: "KAS" } },
] as const;

const SHOOT_OUT = {
  label: COPY.admin.spiel.elfmeterschiessen,
  head: COPY.admin.spiel.afterElfmeterschiessen,
  names: ["shootOut1", "shootOut2"],
  values: ["4", "3"],
  onChange: () => undefined,
  isRequired: false,
} as const;

describe("a score counted from goals entered elsewhere", () => {
  // The harm: a referee reads one club's goals on the other's row, or a box that looks typed and changes nothing.
  it("stands each side's count as a figure on its own club's row, with no box to type it", () => {
    render(
      <ScoreRows
        sides={SIDES}
        tore={{ label: COPY.shared.tore, counted: [5, 1] }}
        shootOut={null}
        outcome={null}
      />,
    );
    const home = screen.getByRole("group", { name: "Ahorn" });
    const guest = screen.getByRole("group", { name: "Kastanie" });
    expect(home.textContent).toContain(`${COPY.shared.tore}5`);
    expect(guest.textContent).toContain(`${COPY.shared.tore}1`);
    expect(screen.queryAllByRole("textbox")).toHaveLength(0);
  });

  it("keeps a shoot-out's fields typed beside the counted figures", () => {
    render(
      <ScoreRows
        sides={SIDES}
        tore={{ label: COPY.shared.tore, counted: [2, 2] }}
        shootOut={SHOOT_OUT}
        outcome={null}
      />,
    );
    const home = screen.getByRole("group", { name: "Ahorn" });
    expect(within(home).getByRole("textbox", { name: COPY.admin.spiel.elfmeterschiessen }).getAttribute("name")).toBe("shootOut1");
    expect(screen.getAllByRole("textbox")).toHaveLength(2);
  });
});
