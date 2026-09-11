import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { sliceBetween } from "@/shared/testing/refusalRegister.ts";

import { FIRST_SAISON_YEAR, FLPostSaisonPayloadSchema, SAISON_ID_PATTERN } from "./schemas.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

// Source text rather than an import: the other half of each pair below is Python, and the frontend
// holds no second copy of either value that could be read in its place.
const SCHEMAS = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "api", "saisons", "schemas.py"), "utf8");

/** The create payload's own declaration, cut at the next class, so a `pattern=` elsewhere in the module cannot answer for it. */
const PAYLOAD_SOURCE = sliceBetween(SCHEMAS, "class FLPostSaisonPayload(", "\nclass ");

/** Renamed on the backend each of these is `undefined`, and the case reading it says which one moved. */
const BACKEND_FIRST_YEAR = /^FIRST_SAISON_YEAR: Final = (\d+)$/m.exec(SCHEMAS)?.[1];
const BACKEND_PATTERN = /pattern=r"([^"]+)"/.exec(PAYLOAD_SOURCE)?.[1];

const rules = {
  win_points: 3,
  draw_points: 1,
  qualifiers_per_group: 2,
  number_of_groups: 4,
  teams_per_group: 4,
  tiebreak_order: "tordifferenz",
  max_kadergroesse: 50,
  forfeit_ergebnis: { sieger_tore: 3, verlierer_tore: 0 },
  erlaubte_stufen: ["E1", "E2", "Q1", "Q2"],
};

/** Every field but the id already legal, so each case below is refused for its id or for nothing. */
const create = (id: string) => ({
  id,
  start_date: "2025-09-01",
  end_date: "2026-06-30",
  bewerbung: { offen: true, von: "2025-05-01", bis: "2025-06-30" },
  rules,
});

const refusals = (id: string): string[] => {
  const result = FLPostSaisonPayloadSchema.safeParse(create(id));

  return result.success ? [] : result.error.issues.map((issue) => issue.path.join("."));
};

/** Computed here the way the schema computes it, so the pair still reads correctly next January. */
const nextYear = new Date().getFullYear() + 1;

describe("the season id mirrors the write path's own rule", () => {
  it("carries the first season the backend names", () => {
    assert.equal(String(FIRST_SAISON_YEAR), BACKEND_FIRST_YEAR);
  });

  it("spells the pattern character for character as the backend spells it", () => {
    assert.equal(SAISON_ID_PATTERN.source, BACKEND_PATTERN);
  });

  it("takes the league's first season and next year", () => {
    assert.deepEqual(refusals(String(FIRST_SAISON_YEAR)), []);
    assert.deepEqual(refusals(String(nextYear)), []);
  });

  it("refuses a year spelled in digits the backend's pattern excludes", () => {
    // Each of these is 2026 to `Number`, so a range check alone would offer all three.
    for (const id of ["２０２６", "٢٠٢٦", "20a6"]) assert.deepEqual(refusals(id), ["id"]);
  });

  it("refuses a year outside the league at either end", () => {
    assert.deepEqual(refusals(String(FIRST_SAISON_YEAR - 1)), ["id"]);
    assert.deepEqual(refusals(String(nextYear + 1)), ["id"]);
  });

  it("refuses an id of the wrong width, for its width alone", () => {
    // One issue and not three: the width, the pattern and the range would each refuse "202".
    assert.deepEqual(refusals("202"), ["id"]);
  });
});
