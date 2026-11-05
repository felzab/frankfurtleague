// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { COPY } from "@/core/copy";

import { ScorePair } from "./ScorePair";

const SIDES = [
  { name: { record: "Ahorn" }, plaque: null },
  { name: { record: "Birke" }, plaque: null },
] as const;

const pair = (captioned: boolean) =>
  render(
    <ScorePair
      label={COPY.admin.spiel.elfmeterschiessen}
      captioned={captioned}
      sides={SIDES}
      names={["shootOut1", "shootOut2"]}
      values={["", ""]}
      onChange={() => undefined}
    />,
  );

// The harm: a knockout's two score boxes read alike on the screen, so the shoot-out is typed into the goals' row.
describe("a score pair's name", () => {
  it("stands over a captioned pair as its caption, which names the group, with no second name beside it", () => {
    pair(true);

    const group = screen.getByRole("group", { name: COPY.admin.spiel.elfmeterschiessen });
    expect(group.getAttribute("aria-label")).toBeNull();
    expect(screen.getByText(COPY.admin.spiel.elfmeterschiessen).id).toBe(group.getAttribute("aria-labelledby"));
  });

  it("names an uncaptioned pair to a screen reader alone", () => {
    pair(false);

    expect(screen.getByRole("group", { name: COPY.admin.spiel.elfmeterschiessen })).toBeTruthy();
    expect(screen.queryByText(COPY.admin.spiel.elfmeterschiessen)).toBeNull();
  });
});
