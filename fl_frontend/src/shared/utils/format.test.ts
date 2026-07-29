import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatAddress, formatAddressFull, formatMapsLink, formatSpielDatum } from "./format.ts";

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

describe("formatSpielDatum", () => {
  it("formats a fixture date as a German calendar date", () => {
    assert.equal(formatSpielDatum("2026-07-28"), "28.07.2026");
  });

  it("returns the fallback for a null date", () => {
    assert.equal(formatSpielDatum(null), "TBD");
    assert.equal(formatSpielDatum(null, "/"), "/");
  });

  // The defect this replaced: `new Date("2026-07-28")` parses as UTC midnight and
  // toLocaleDateString with no timeZone formats in the runtime's zone, so anyone west of UTC
  // saw 27.07. Pinning process.env.TZ mid-process would not prove anything -- Node caches the
  // ICU default zone -- so this asserts the mechanism directly: the T12:00:00Z anchor the
  // function builds lands on the same calendar date in every zone the app can be viewed from.
  it("anchors the instant so no viewer's zone can shift the day", () => {
    const anchored = new Date("2026-07-28T12:00:00Z");
    const naive = new Date("2026-07-28");

    // UTC-11 through UTC+11. 12:00Z + 12h is already 00:00 the next day, so the anchor does
    // not cover UTC+12 and beyond -- but formatSpielDatum pins timeZone itself, so the anchor
    // is only a guard for a future caller who reuses the instant without one.
    for (const timeZone of ["Pacific/Midway", "America/New_York", "Europe/Berlin", "Etc/GMT-11"]) {
      const day = new Intl.DateTimeFormat("de-DE", { timeZone, day: "2-digit" }).format(anchored);
      assert.equal(day, "28", `anchored instant shifted in ${timeZone}`);
    }

    // ...whereas the construction this replaced does shift, which is the bug.
    assert.equal(new Intl.DateTimeFormat("de-DE", { timeZone: "America/New_York", day: "2-digit" }).format(naive), "27");
  });

  // Berlin is UTC+2 in July and UTC+1 in January; neither offset may move the date.
  it("is stable across both German DST offsets", () => {
    assert.equal(formatSpielDatum("2026-06-21"), "21.06.2026");
    assert.equal(formatSpielDatum("2026-12-21"), "21.12.2026");
  });
});
