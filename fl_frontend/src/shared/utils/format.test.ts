import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatAddress, formatAddressFull, formatMapsLink } from "./format.ts";

const address = {
  strasse: "Hanauer Landstraße",
  hausnummer: "12a",
  plz: "60314",
  stadtteil: "Ostend",
  stadt: "Frankfurt am Main",
};

describe("formatAddress", () => {
  it("formats a complete address", () => {
    assert.equal(formatAddress(address), "Hanauer Landstraße 12a, 60314 Frankfurt am Main (Ostend)");
  });

  it("returns the placeholder when no address is given", () => {
    assert.equal(formatAddress(undefined), "Keine Adresse hinterlegt");
    assert.equal(formatAddress(), "Keine Adresse hinterlegt");
  });

  // hausnummer and stadtteil are both allowed to be "" by FLAddressSchema; this documents
  // what the current implementation renders in that case rather than asserting it is nice.
  it("renders empty optional parts verbatim", () => {
    assert.equal(formatAddress({ ...address, hausnummer: "", stadtteil: "" }), "Hanauer Landstraße , 60314 Frankfurt am Main ()");
  });
});

describe("formatAddressFull", () => {
  it("appends the country and puts stadtteil before stadt", () => {
    assert.equal(formatAddressFull(address), "Hanauer Landstraße 12a, 60314 Ostend Frankfurt am Main, Deutschland");
  });

  it("renders an empty stadtteil as a double space", () => {
    assert.equal(formatAddressFull({ ...address, stadtteil: "" }), "Hanauer Landstraße 12a, 60314  Frankfurt am Main, Deutschland");
  });
});

describe("formatMapsLink", () => {
  const ort = { id: "6890a1b2c3d4e5f607182930", address, name: "Sportplatz Ost", maps_link: "", default_mietpreis: 50, is_inactive: false };

  it("builds a Google Maps search URL from the name and full address", () => {
    assert.equal(
      formatMapsLink(ort),
      "https://www.google.com/maps/search/?api=1&query=Sportplatz%20Ost%2C%20Hanauer%20Landstra%C3%9Fe%2012a%2C%2060314%20Ostend%20Frankfurt%20am%20Main%2C%20Deutschland",
    );
  });

  // The query is the only user-controlled part of the URL, so encoding is the thing to pin.
  it("percent-encodes characters that would otherwise break the query", () => {
    const link = formatMapsLink({ ...ort, name: "Platz & Halle #2" });
    assert.ok(link.includes("Platz%20%26%20Halle%20%232"));
    assert.ok(!link.includes("&query=Platz &"));
  });
});
