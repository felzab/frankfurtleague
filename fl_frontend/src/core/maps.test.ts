import { describe, expect, it } from "vitest";

import { buildMapsSearchUrl } from "./maps.ts";

describe("buildMapsSearchUrl", () => {
  // An `&` the query left bare would end it there, and `encodeURI` leaves one bare where `encodeURIComponent` does not.
  it("wraps a query in a Google Maps search URL, encoded as one parameter", () => {
    expect(buildMapsSearchUrl("Platz & Halle")).toBe("https://www.google.com/maps/search/?api=1&query=Platz%20%26%20Halle");
  });
});
