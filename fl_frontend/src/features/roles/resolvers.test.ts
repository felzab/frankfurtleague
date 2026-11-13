import { refused } from "@/test-support/refusals.ts";
import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes.ts";

import { readAsRoleHolder } from "./resolvers.ts";

// The harm: a pupil or a referee whose Funktion went between the page's check and the backend's meets the error card,
// which says something broke, where every other place of theirs sends them on to the landing.
describe("a person place's read the backend refuses for a Funktion gone", () => {
  it("sends the person on to the landing", async () => {
    const thrown: unknown = await readAsRoleHolder("spieler", () => Promise.reject(refused("role_not_held"))).catch((error: unknown) => error);
    const digest = thrown instanceof Error && "digest" in thrown ? String(thrown.digest) : "";

    expect(digest.split(";").slice(0, 3)).toStrictEqual(["NEXT_REDIRECT", "replace", ROUTES.area.path()]);
  });
});
