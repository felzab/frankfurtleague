/**
 * SHARED · format tests
 *
 * Covers the display formatters and the shared placeholders. The cases that matter are the ones a
 * reader would not think to write: `formatSpielDatum` is pinned against both German DST offsets and
 * against a viewer in another timezone, because the failure it guards is a date rendering one day off
 * for some users and not others.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildMapsSearchUrl, formatAddress, formatAddressFull, formatEuro, formatSpielDatum, formatUhrzeit, PLACEHOLDER } from "./format.ts";

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

  // Stadtteil is optional: an address without one is complete, so nothing may render an empty
  // "()" tail. The hausnummer's trailing space stays — the street template keeps one slot for it.
  it("drops the stadtteil parenthesis when it is empty", () => {
    assert.equal(formatAddress({ ...address, hausnummer: "", stadtteil: "" }), "Hanauer Landstraße , 60314 Frankfurt am Main");
  });
});

describe("formatAddressFull", () => {
  it("appends the country and puts stadtteil before stadt", () => {
    assert.equal(formatAddressFull(address), "Hanauer Landstraße 12a, 60314 Ostend Frankfurt am Main, Deutschland");
  });

  it("renders an empty stadtteil without a double space", () => {
    assert.equal(formatAddressFull({ ...address, stadtteil: "" }), "Hanauer Landstraße 12a, 60314 Frankfurt am Main, Deutschland");
  });
});

describe("buildMapsSearchUrl", () => {
  it("wraps a query in a Google Maps search URL", () => {
    assert.equal(buildMapsSearchUrl("Sportplatz Ost"), "https://www.google.com/maps/search/?api=1&query=Sportplatz%20Ost");
  });

  // The query is the only caller-controlled part of the URL, so encoding is the thing to pin.
  it("percent-encodes characters that would otherwise break the query", () => {
    const link = buildMapsSearchUrl("Platz & Halle #2");
    assert.ok(link.includes("Platz%20%26%20Halle%20%232"));
    assert.ok(!link.includes("&query=Platz &"));
  });

  it("returns a bare query parameter for an empty string", () => {
    assert.equal(buildMapsSearchUrl(""), "https://www.google.com/maps/search/?api=1&query=");
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

  it("defaults to the shared date placeholder", () => {
    assert.equal(formatSpielDatum(null), PLACEHOLDER.datum);
  });
});

describe("formatEuro", () => {
  //   is the non-breaking space de-DE puts before the currency symbol.
  it("formats an amount as German euros", () => {
    assert.equal(formatEuro(25), "25,00 €");
    assert.equal(formatEuro(0), "0,00 €");
  });

  it("groups thousands and keeps two decimals", () => {
    assert.equal(formatEuro(1234.5), "1.234,50 €");
  });

  // The value is euros, not cents: `formatEuro` must never divide by 100.
  it("does not divide by 100", () => {
    assert.equal(formatEuro(100), "100,00 €");
  });
});

describe("formatUhrzeit", () => {
  it("passes an HH:MM time through", () => {
    assert.equal(formatUhrzeit("14:00"), "14:00");
  });

  it("truncates seconds a backend might send", () => {
    assert.equal(formatUhrzeit("14:00:00"), "14:00");
  });

  it("returns the shared time placeholder for missing values", () => {
    assert.equal(formatUhrzeit(null), "--:--");
    assert.equal(formatUhrzeit(undefined), "--:--");
    // "" is falsy and must take the placeholder too -- the cards' old `|| "--:--"` relied on that.
    assert.equal(formatUhrzeit(""), "--:--");
    assert.equal(formatUhrzeit(null), PLACEHOLDER.uhrzeit);
  });

  it("accepts an explicit fallback", () => {
    assert.equal(formatUhrzeit(null, "/"), "/");
  });
});
