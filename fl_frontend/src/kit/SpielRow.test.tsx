// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { SpielList } from "./SpielRow";

import type { SpielRowProps } from "./SpielRow";

const SPIEL: SpielRowProps & { id: string } = {
  id: "spiel-1",
  when: COPY.shared.saved,
  team1: { name: { record: "Ahorn" }, plaque: { record: "AHO" } },
  team2: { name: { record: "Eiche" }, plaque: { record: "EIC" } },
};

// The harm: a match of a season not yet public drawn as a link, which opens a page answering „Seite nicht gefunden“.
describe("a match's row", () => {
  it("leads to its match where it has an address, and opens nothing where it has none", () => {
    const { rerender } = render(<SpielList matches={[{ ...SPIEL, href: "/saisons/2027/spiele/spiel-1" }]} />);
    expect(screen.getByRole("link")).toBeTruthy();

    rerender(<SpielList matches={[SPIEL]} />);
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getAllByText("Ahorn").length).toBeGreaterThan(0);
  });
});
