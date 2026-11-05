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
  it.each([true, false])("names the group, captioned %s", (captioned) => {
    pair(captioned);

    expect(screen.getByRole("group", { name: COPY.admin.spiel.elfmeterschiessen })).toBeTruthy();
  });
});
