import { describe, expect, it } from "vitest";

import { chosenTab } from "./tabChoice";

describe("the server's choice of tab", () => {
  const IDS = ["st-1", "st-2", "st-3"];

  it("opens on the tab the address names", () => {
    expect(chosenTab({ tab: "st-3" }, IDS, "st-2")).toBe("st-3");
  });
});
