import { describe, expect, it } from "vitest";

import { currentOf } from "./navPlace";

// The account menu's layout stands above a team's address, so it can name the kind of place and never which team or
// season: a place read there lands on the first of a person's team places wherever they are. The menu marks under
// „Funktion wechseln“ the place this answers, and the rail's row reads that place's line under the name.
describe("the place a page lies under", () => {
  const PLACES = ["/area/team/ahorn/2027", "/area/team/ahorn/2026", "/area/team/weide/2027", "/admin"] as const;

  it("is the one the path lies under, by its team and season, and none where the path lies under no place", () => {
    expect(currentOf("/area/team/ahorn/2026/kader", PLACES)).toBe("/area/team/ahorn/2026");
    expect(currentOf("/admin/spielorte", PLACES)).toBe("/admin");
    expect(currentOf("/account/security", PLACES)).toBeNull();
  });
});
