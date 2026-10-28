// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MatchList } from "./MatchRow";

const MATCH = {
  id: "1",
  href: "/saisons/2027",
  when: "Mi, 14.04. · 15:30",
  home: { name: "Goethe", plaque: { kuerzel: "GOE" } },
  away: { name: "Helmholtz", plaque: { kuerzel: "HEL" } },
} as const;

describe("a match row's chevron", () => {
  it("ends the desktop row, which stands in a list, and is left off the phone's card", () => {
    render(<MatchList matches={[MATCH]} />);
    const [desktop, phone] = [...screen.getByRole("link").children];
    expect(desktop?.className.split(" ")).toContain("max-lg:hidden");
    expect(desktop?.lastElementChild?.querySelector("svg")).not.toBe(null);
    expect(phone?.className.split(" ")).toContain("lg:hidden");
    // The phone's card draws its plaques, and no other glyph.
    expect(phone?.querySelector("svg")).toBe(null);
  });
});
