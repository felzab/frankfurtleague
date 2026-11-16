import { refused } from "@/test-support/refusals.ts";
import { thrownRedirect } from "@/test-support/thrownRedirect.ts";
import { describe, expect, it } from "vitest";

import { ROUTES } from "@/core/routes.ts";

import { readAsRoleHolder } from "./resolvers.ts";

// The harm: a pupil or a referee whose Funktion went between the page's check and the backend's meets the error card,
// which says something broke, where every other place of theirs sends them on to the landing.
describe("a person place's read the backend refuses for a Funktion gone", () => {
  it("sends the person on to the landing", async () => {
    const redirect = await thrownRedirect(readAsRoleHolder("spieler", () => Promise.reject(refused("role_not_held"))));

    expect([redirect.type, redirect.address]).toStrictEqual(["replace", ROUTES.area.path()]);
  });
});
