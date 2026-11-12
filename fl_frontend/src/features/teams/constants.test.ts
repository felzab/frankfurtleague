import { describe, expect, it } from "vitest";

import { adminTeamChip, austrittChip } from "./constants";

// The public two letters and the administration's word stand for one exit: two hues for it read as two states.
describe("a club's exit chip", () => {
  it("is red for either route, on the public pages and in the administration alike", () => {
    expect([austrittChip("disqualifikation"), austrittChip("rueckzug")].map(({ tone }) => tone)).toStrictEqual(["danger", "danger"]);
    expect([adminTeamChip(null, "disqualifikation"), adminTeamChip(null, "rueckzug")].map((chip) => chip?.tone)).toStrictEqual([
      "danger",
      "danger",
    ]);
  });
});
