import { describe, expect, it } from "vitest";
import { z } from "zod";

import { buildMapsSearchUrl } from "@/shared/utils/format.ts";

import { FLSpielortSchema } from "./schemas.ts";
import { formatMapsLink } from "./utils.ts";

/** The line the backend stores for each shape of address, which the venue table must search for alike. */
const ADDRESS_LINES: unknown = [
  {
    case: "a complete address",
    name: "Sportplatz Ost",
    address: {
      strasse: "Hanauer Landstraße",
      hausnummer: "12a",
      plz: "60314",
      stadtteil: "Ostend",
      stadt: "Frankfurt am Main",
    },
    maps_link: "Sportplatz Ost, Hanauer Landstraße 12a, 60314 Ostend Frankfurt am Main, Deutschland",
  },
  {
    case: "no house number",
    name: "Sportplatz Ost",
    address: {
      strasse: "Hanauer Landstraße",
      hausnummer: "",
      plz: "60314",
      stadtteil: "Ostend",
      stadt: "Frankfurt am Main",
    },
    maps_link: "Sportplatz Ost, Hanauer Landstraße, 60314 Ostend Frankfurt am Main, Deutschland",
  },
  {
    case: "no district",
    name: "Sportplatz Ost",
    address: {
      strasse: "Hanauer Landstraße",
      hausnummer: "12a",
      plz: "60314",
      stadtteil: "",
      stadt: "Frankfurt am Main",
    },
    maps_link: "Sportplatz Ost, Hanauer Landstraße 12a, 60314 Frankfurt am Main, Deutschland",
  },
  {
    case: "neither",
    name: "Sportplatz Ost",
    address: {
      strasse: "Hanauer Landstraße",
      hausnummer: "",
      plz: "60314",
      stadtteil: "",
      stadt: "Frankfurt am Main",
    },
    maps_link: "Sportplatz Ost, Hanauer Landstraße, 60314 Frankfurt am Main, Deutschland",
  },
  {
    case: "a district of spaces alone",
    name: "Sportplatz Ost",
    address: {
      strasse: "Hanauer Landstraße",
      hausnummer: "12a",
      plz: "60314",
      stadtteil: "   ",
      stadt: "Frankfurt am Main",
    },
    maps_link: "Sportplatz Ost, Hanauer Landstraße 12a, 60314 Frankfurt am Main, Deutschland",
  },
];

const CASES = z.array(FLSpielortSchema.pick({ name: true, address: true, maps_link: true }).extend({ case: z.string() })).parse(ADDRESS_LINES);

describe("the venue line against the one the backend stores", () => {
  for (const { case: shape, ...venue } of CASES) {
    it(`links the venue table to the stored line's search for ${shape}`, () => {
      // The fixture dialog wraps the stored line; the venue table rebuilds it from name and address.
      expect(formatMapsLink({ ...venue, id: "6890a1b2c3d4e5f607182930", default_mietpreis: 0, inactive_since: null })).toBe(
        buildMapsSearchUrl(venue.maps_link),
      );
    });
  }
});
