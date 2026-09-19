import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { z } from "zod";

import { buildMapsSearchUrl } from "@/shared/utils/format.ts";

import { FLSpielortSchema } from "./schemas.ts";
import { formatMapsLink } from "./utils.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

// Read rather than retyped: `fl_backend/tests/shared/test_frontend_mirrors.py` runs `_maps_link` over
// the same rows, so a join changed at one tier fails that tier's own suite.
const CASES = z
  .array(FLSpielortSchema.pick({ name: true, address: true, maps_link: true }).extend({ case: z.string() }))
  .parse(JSON.parse(readFileSync(path.resolve(REPO_ROOT, "fl_backend", "tests", "shared", "address_lines.json"), "utf8")));

describe("the venue line against the one the backend stores", () => {
  it("reads rows out of the shared table", () => {
    assert.ok(CASES.length > 0, "the shared table holds no row, so every comparison below is vacuous");
  });

  for (const { case: shape, ...venue } of CASES) {
    it(`links the venue table to the stored line's search for ${shape}`, () => {
      // The fixture dialog wraps the stored line; the venue table rebuilds it from name and address.
      assert.equal(
        formatMapsLink({ ...venue, id: "6890a1b2c3d4e5f607182930", default_mietpreis: 0, inactive_since: null }),
        buildMapsSearchUrl(venue.maps_link),
      );
    });
  }
});
