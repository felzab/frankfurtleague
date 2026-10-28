import { assert, describe, expect, it } from "vitest";

import {
  buildMapsSearchUrl,
  formatAddress,
  formatAddressFull,
  formatEuro,
  formatSpielDatum,
  formatUhrzeit,
  NICHT_HINTERLEGT,
  nichtHinterlegt,
  PLACEHOLDER,
} from "./format.ts";

describe("the two forms of an empty stored field", () => {
  it("reads „Nicht hinterlegt“ beside a label, and names the field where none stands", () => {
    expect(NICHT_HINTERLEGT).toBe("Nicht hinterlegt");
    expect(nichtHinterlegt("E-Mail")).toBe("E-Mail nicht hinterlegt");
  });
});

const address = {
  strasse: "Hanauer Landstraße",
  hausnummer: "12a",
  plz: "60314",
  stadtteil: "Ostend",
  stadt: "Frankfurt am Main",
};

describe("formatAddress", () => {
  it("formats a complete address", () => {
    expect(formatAddress(address)).toBe("Hanauer Landstraße 12a, 60314 Frankfurt am Main (Ostend)");
  });

  it("returns the placeholder when no address is given", () => {
    expect(formatAddress(undefined)).toBe("Adresse nicht hinterlegt");
    expect(formatAddress()).toBe("Adresse nicht hinterlegt");
  });

  // Stadtteil is optional: an address without one is complete, so nothing may render an empty "()" tail.
  it("drops the stadtteil parenthesis when it is empty", () => {
    expect(formatAddress({ ...address, stadtteil: "" })).toBe("Hanauer Landstraße 12a, 60314 Frankfurt am Main");
  });

  it("closes the street up to its comma where the hausnummer is empty", () => {
    expect(formatAddress({ ...address, hausnummer: "" })).toBe("Hanauer Landstraße, 60314 Frankfurt am Main (Ostend)");
  });

  it("drops an empty hausnummer and an empty stadtteil together", () => {
    expect(formatAddress({ ...address, hausnummer: "", stadtteil: "" })).toBe("Hanauer Landstraße, 60314 Frankfurt am Main");
  });

  it("reads a part holding only whitespace as empty", () => {
    expect(formatAddress({ ...address, hausnummer: " ", stadtteil: " " })).toBe("Hanauer Landstraße, 60314 Frankfurt am Main");
  });
});

describe("formatAddressFull", () => {
  it("appends the country and puts stadtteil before stadt", () => {
    expect(formatAddressFull(address)).toBe("Hanauer Landstraße 12a, 60314 Ostend Frankfurt am Main, Deutschland");
  });

  it("renders an empty stadtteil without a double space", () => {
    expect(formatAddressFull({ ...address, stadtteil: "" })).toBe("Hanauer Landstraße 12a, 60314 Frankfurt am Main, Deutschland");
  });

  // The venue list copies this line to the clipboard, so a stray space before the comma travels into
  // whatever message it is pasted in.
  it("closes the street up to its comma where the hausnummer is empty", () => {
    expect(formatAddressFull({ ...address, hausnummer: "" })).toBe("Hanauer Landstraße, 60314 Ostend Frankfurt am Main, Deutschland");
  });

  it("drops an empty hausnummer and an empty stadtteil together", () => {
    expect(formatAddressFull({ ...address, hausnummer: "", stadtteil: "" })).toBe("Hanauer Landstraße, 60314 Frankfurt am Main, Deutschland");
  });

  it("reads a part holding only whitespace as empty", () => {
    expect(formatAddressFull({ ...address, hausnummer: " ", stadtteil: " " })).toBe("Hanauer Landstraße, 60314 Frankfurt am Main, Deutschland");
  });
});

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

describe("formatSpielDatum", () => {
  it("formats a fixture date as a German calendar date", () => {
    expect(formatSpielDatum("2026-07-28")).toBe("28.07.2026");
  });

  it("returns the fallback for a null date", () => {
    expect(formatSpielDatum(null)).toBe("Termin offen");
    expect(formatSpielDatum(null, "/")).toBe("/");
  });

  // `new Date("2026-07-28")` parses as UTC midnight, and toLocaleDateString with no timeZone formats
  // in the runtime's zone, so anyone west of UTC reads 27.07.

  // Pinning process.env.TZ mid-process proves nothing -- Node caches the ICU default zone -- so this
  // asserts the mechanism: the T12:00:00Z anchor lands on the same calendar date in every zone.
  it("anchors the instant so no viewer's zone can shift the day", () => {
    const anchored = new Date("2026-07-28T12:00:00Z");
    const naive = new Date("2026-07-28");

    // UTC-11 through UTC+11: midday plus twelve hours is already the next day, so this does not
    // reach UTC+12. `formatSpielDatum` pins the zone itself, so this guards a future reuse.
    for (const timeZone of ["Pacific/Midway", "America/New_York", "Europe/Berlin", "Etc/GMT-11"]) {
      const day = new Intl.DateTimeFormat("de-DE", { timeZone, day: "2-digit" }).format(anchored);
      expect(day, `anchored instant shifted in ${timeZone}`).toBe("28");
    }

    // ...whereas the construction this replaced does shift, which is the bug.
    expect(new Intl.DateTimeFormat("de-DE", { timeZone: "America/New_York", day: "2-digit" }).format(naive)).toBe("27");
  });

  // Berlin is UTC+2 in July and UTC+1 in January; neither offset may move the date.
  it("is stable across both German DST offsets", () => {
    expect(formatSpielDatum("2026-06-21")).toBe("21.06.2026");
    expect(formatSpielDatum("2026-12-21")).toBe("21.12.2026");
  });

  it("defaults to the shared date placeholder", () => {
    expect(formatSpielDatum(null)).toBe(PLACEHOLDER.datum);
  });
});

describe("formatEuro", () => {
  //   is the non-breaking space de-DE puts before the currency symbol.
  it("formats an amount as German euros", () => {
    expect(formatEuro(25)).toBe("25,00 €");
    expect(formatEuro(0)).toBe("0,00 €");
  });

  it("groups thousands and keeps two decimals", () => {
    expect(formatEuro(1234.5)).toBe("1.234,50 €");
  });

  // The value is euros, not cents: `formatEuro` must never divide by 100.
  it("does not divide by 100", () => {
    expect(formatEuro(100)).toBe("100,00 €");
  });
});

describe("formatUhrzeit", () => {
  it("passes an HH:MM time through", () => {
    expect(formatUhrzeit("14:00")).toBe("14:00");
  });

  it("truncates seconds a backend might send", () => {
    expect(formatUhrzeit("14:00:00")).toBe("14:00");
  });

  it("returns the shared time placeholder for missing values", () => {
    expect(formatUhrzeit(null)).toBe("--:--");
    expect(formatUhrzeit(undefined)).toBe("--:--");
    // "" is falsy and must take the placeholder too -- the cards' old `|| "--:--"` relied on that.
    expect(formatUhrzeit("")).toBe("--:--");
    expect(formatUhrzeit(null)).toBe(PLACEHOLDER.uhrzeit);
  });

  it("accepts an explicit fallback", () => {
    expect(formatUhrzeit(null, "/")).toBe("/");
  });
});
