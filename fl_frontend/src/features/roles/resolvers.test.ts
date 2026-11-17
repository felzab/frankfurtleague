import { thrownRedirect } from "@/test-support/thrownRedirect";
import { describe, expect, it } from "vitest";

import { APIBadStatusError } from "@/core/errors";
import { ROUTES } from "@/core/routes";

import { readAsRoleHolder } from "./resolvers";

// The harm: a pupil or a referee whose Funktion went between the page's check and the backend's meets the error card,
// which says something broke, where every other place of theirs sends them on to the landing.
describe("a person place's read the backend refuses for a Funktion gone", () => {
  it("sends the person on to the landing", async () => {
    const gone = new APIBadStatusError({ message: "refused", statusCode: 409, serverErrorCode: "role_not_held", traceId: "0" });
    const redirect = await thrownRedirect(readAsRoleHolder("spieler", () => Promise.reject(gone)));

    expect([redirect.type, redirect.address]).toStrictEqual(["replace", ROUTES.area.path()]);
  });
});
