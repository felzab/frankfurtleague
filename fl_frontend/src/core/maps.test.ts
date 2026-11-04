import { assert, describe, expect, it } from "vitest";

import { buildMapsSearchUrl } from "./maps.ts";

describe("buildMapsSearchUrl", () => {
  it("wraps a query in a Google Maps search URL", () => {
    expect(buildMapsSearchUrl("Sportplatz Ost")).toBe("https://www.google.com/maps/search/?api=1&query=Sportplatz%20Ost");
  });

  // The query is the only caller-controlled part of the URL, so encoding is the thing to pin.
  it("percent-encodes characters that would otherwise break the query", () => {
    const link = buildMapsSearchUrl("Platz & Halle #2");
    assert.ok(link.includes("Platz%20%26%20Halle%20%232"));
    assert.ok(!link.includes("&query=Platz &"));
  });

  it("returns a bare query parameter for an empty string", () => {
    expect(buildMapsSearchUrl("")).toBe("https://www.google.com/maps/search/?api=1&query=");
  });
});
