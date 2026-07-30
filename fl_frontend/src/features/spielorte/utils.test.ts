import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatMapsLink } from "./utils.ts";

const address = {
  strasse: "Hanauer Landstraße",
  hausnummer: "12a",
  plz: "60314",
  stadtteil: "Ostend",
  stadt: "Frankfurt am Main",
};

const ort = { id: "6890a1b2c3d4e5f607182930", address, name: "Sportplatz Ost", maps_link: "", default_mietpreis: 50, is_inactive: false };

describe("formatMapsLink", () => {
  it("builds a Google Maps search URL from the name and full address", () => {
    assert.equal(
      formatMapsLink(ort),
      "https://www.google.com/maps/search/?api=1&query=Sportplatz%20Ost%2C%20Hanauer%20Landstra%C3%9Fe%2012a%2C%2060314%20Ostend%20Frankfurt%20am%20Main%2C%20Deutschland",
    );
  });

  // Searching by name as well as address is what makes the pin land on the venue rather than the
  // street, so the name has to survive into the query.
  it("puts the venue name ahead of the address", () => {
    assert.ok(formatMapsLink(ort).includes("query=Sportplatz%20Ost%2C%20"));
  });

  it("percent-encodes a name that would otherwise break the query", () => {
    assert.ok(formatMapsLink({ ...ort, name: "Platz & Halle #2" }).includes("Platz%20%26%20Halle%20%232"));
  });
});
