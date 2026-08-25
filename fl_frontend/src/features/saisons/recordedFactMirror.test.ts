import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { sliceBetween } from "../../core/refusalRegister.ts";
import { FLSaisonPhaseSchema } from "./schemas.ts";
import { holdsARecordedFact } from "./utils.ts";

import type { FLSpiel } from "../spiele/schemas.ts";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");

// Source text rather than an import: the other half of this window is Python, and the frontend holds
// no second copy of the projection that could be read in its place.
const SERVICES = readFileSync(path.resolve(REPO_ROOT, "fl_backend", "app", "api", "saisons", "services.py"), "utf8");

/** The tuple's own source, cut at the closing paren none of its entries can contain. */
const PROJECTION_SOURCE = sliceBetween(SERVICES, "RECORDED_FACT_FIELDS: tuple[str, ...] = (", ")");

/* The group sits outside every alternation, so a match always fills it. `noUncheckedIndexedAccess`
   cannot see that, and a cast would hide a pattern that later could not. */
const BACKEND_PROJECTION: string[] = [...PROJECTION_SOURCE.matchAll(/"([^"]+)"/g)].flatMap((match) =>
  match[1] === undefined ? [] : [match[1]],
);

/** Renamed on the backend this is `undefined`, and the schema refuses it by name as this file loads. */
const DRAWN_PHASE = FLSaisonPhaseSchema.parse(/DRAWN_HOLDING_ITS_SIDES: FLSaisonPhase = "([^"]+)"/.exec(SERVICES)?.[1]);

/** Any phase the draw wires instead of filling, read off the enum so no second phase name is spelled here. */
const BRACKET_PHASE = FLSaisonPhaseSchema.options.find((phase) => phase !== DRAWN_PHASE) ?? DRAWN_PHASE;

const TEAM_1 = "2".repeat(24);
const TEAM_2 = "3".repeat(24);

const seite = (tore: number | null, teamId: string): FLSpiel["team1"] => ({
  team_id: teamId,
  tore,
  name: "SV Beispiel",
  shorthand: "SVB",
  austritt_type: null,
});

const QUELLE: FLSpiel["team1_quelle"] = { type: "gruppe", gruppe: "A", platz: 1 };
const ORT: FLSpiel["ort"] = { spielort_id: "4".repeat(24), name: "Platz 1", maps_link: "https://example.invalid" };
const SCHIRI: FLSpiel["schiedsrichter"] = { schiedsrichter_id: "5".repeat(24), name: "A. Beispiel" };

/** A group fixture exactly as the draw leaves it — both sides OCCUPIED, neither wired, nothing entered. */
const DRAWN_GRUPPENSPIEL: FLSpiel = {
  id: "0".repeat(24),
  spieltag_id: "1".repeat(24),
  team1: seite(null, TEAM_1),
  team2: seite(null, TEAM_2),
  team1_quelle: null,
  team2_quelle: null,
  datum: null,
  uhrzeit: null,
  ort: null,
  schiedsrichter: null,
  ergebnis: null,
  elfmeterschiessen: null,
  spiel_nr: 1,
  sonderereignis: null,
  saison_phase: DRAWN_PHASE,
  saison_id: "2026",
  notiz: null,
};

/** The same draw's bracket fixture — WIRED and empty, the exact inverse of the shape above. */
const DRAWN_KOSPIEL: FLSpiel = {
  ...DRAWN_GRUPPENSPIEL,
  saison_phase: BRACKET_PHASE,
  team1: null,
  team2: null,
  team1_quelle: QUELLE,
  team2_quelle: { type: "spiel", spiel_nr: 3, ausgang: "sieger" },
};

interface RecordedEdit {
  /** What an admin did to the fixture, so a failure names the fact the window stopped seeing. */
  readonly why: string;
  /** The edit judged against a drawn GROUP fixture. */
  readonly gruppe: Partial<FLSpiel>;
  /** The edit against a drawn BRACKET fixture, declared only where the draw leaves the field inverted. */
  readonly ko?: Partial<FLSpiel>;
}

/**
 * Backend projection path → an edit departing from the draw in that field alone.
 *
 * **The keys mirror `RECORDED_FACT_FIELDS`**, pinned by the test below, so the list cannot shrink to
 * whatever the predicate happens to read.
 */
const RECORDED_EDITS: Record<string, RecordedEdit> = {
  // No record of its own -- it is the DISCRIMINATOR, so its entry flips the phase under an untouched
  // pair of sides. Read the wrong one and every drawn season is misjudged in one direction or other.
  saison_phase: {
    why: "no record of its own, so its edit is the flip under untouched sides",
    gruppe: { saison_phase: BRACKET_PHASE },
    ko: { saison_phase: DRAWN_PHASE },
  },

  team1: { why: "an emptied group side, and a bracket slot somebody filled", gruppe: { team1: null }, ko: { team1: seite(null, TEAM_1) } },
  team2: {
    why: "the same on the other side, which a loop over one slot would miss",
    gruppe: { team2: null },
    ko: { team2: seite(null, TEAM_2) },
  },

  // Sides left occupied and unwired, so only the goal count can be what answers.
  "team1.tore": { why: "a goal count standing without a result", gruppe: { team1: seite(0, TEAM_1) } },
  "team2.tore": { why: "the same count on the other side", gruppe: { team2: seite(0, TEAM_2) } },

  team1_quelle: {
    why: "a provenance on a group side, and a cleared one on a bracket slot",
    gruppe: { team1_quelle: QUELLE },
    ko: { team1_quelle: null },
  },
  team2_quelle: { why: "the same on the other side", gruppe: { team2_quelle: QUELLE }, ko: { team2_quelle: null } },

  ergebnis: { why: "a result", gruppe: { ergebnis: "2:1" } },
  elfmeterschiessen: {
    why: "a shoot-out standing without a result, which only a hand edit leaves",
    gruppe: { elfmeterschiessen: { team1: 5, team2: 4 } },
  },
  // The cancellation on purpose: `hasTakenPlace` reads it as untouched, so reaching for that narrower
  // set instead of this window is the mistake this entry is here to fail.
  sonderereignis: { why: "a cancellation, which awards nothing and is still a record", gruppe: { sonderereignis: "ausgefallen" } },

  ort: { why: "a booked venue", gruppe: { ort: ORT } },
  schiedsrichter: { why: "a booked referee", gruppe: { schiedsrichter: SCHIRI } },
  notiz: { why: "an admin's note", gruppe: { notiz: "Platz gesperrt" } },
};

/**
 * Projected paths the wire delivers as the head object itself, each with why.
 *
 * Never widened to "any leaf": a NEW leaf under `team1` is a new record, and folding every leaf into
 * its head would hand that leaf a mirror entry which already exists.
 */
const JOINED_AS_A_WHOLE: Record<string, string> = {
  "team1.team_id": "the joined side arrives whole or `null`, so its id is the slot being occupied",
  "team2.team_id": "the joined side arrives whole or `null`, so its id is the slot being occupied",
  "ort.spielort_id": "the booking arrives whole or `null`, so its id is the venue being booked",
  "schiedsrichter.schiedsrichter_id": "the booking arrives whole or `null`, so its id is the referee being booked",
};

/** The projection's own path, reduced to the key a joined response carries. */
function mirroredKey(projected: string): string {
  // The unlisted path comes back WHOLE rather than as its head, so a leaf nobody declared fails the
  // comparison naming itself. That is the point of listing four paths instead of splitting on a dot.
  return projected in JOINED_AS_A_WHOLE ? (projected.split(".")[0] ?? projected) : projected;
}

describe("the replace window against the backend's own projection", () => {
  /* First, because a boundary string that stopped matching leaves the projection empty, and the
     comparison below would then fail for something that is not the drift it is here to catch. */
  it("cuts the projection out of the module before reading it", () => {
    assert.ok(PROJECTION_SOURCE.includes('"saison_phase"'), "the tuple's first entry is outside its slice");
    assert.ok(!PROJECTION_SOURCE.includes("DRAWN_HOLDING_ITS_SIDES"), "the tuple's slice runs on past its closing paren");

    assert.ok(BACKEND_PROJECTION.length > 0, "the projection parsed to nothing, so every comparison over it is vacuous");
    assert.notEqual(BRACKET_PHASE, DRAWN_PHASE, "the phase enum holds one entry, so no bracket fixture can be built");
  });

  /* THE COUPLING. A field added to `RECORDED_FACT_FIELDS` fails here naming itself, and the entry
     that answers it then has to satisfy the assertions below before the suite goes green again. */
  it("weighs every field the endpoint projects, and no field it does not", () => {
    // The collapses are checked against the projection first: an entry naming a path the endpoint
    // stopped projecting would go on folding a key the comparison below can no longer see.
    for (const [projected, why] of Object.entries(JOINED_AS_A_WHOLE)) {
      assert.ok(
        BACKEND_PROJECTION.includes(projected),
        `${projected} is folded into its head on the grounds that ${why}, and is not projected`,
      );
    }

    const mirrored = [...new Set(BACKEND_PROJECTION.map(mirroredKey))].sort();

    assert.deepEqual(Object.keys(RECORDED_EDITS).sort(), mirrored);
  });

  /* The floor, and the one that matters: a predicate answering true for everything would satisfy
     every case below, and no drawn season would ever be offered the replace at all. */
  it("reads a fixture the draw left alone as holding nothing, in both shapes", () => {
    assert.equal(holdsARecordedFact(DRAWN_GRUPPENSPIEL), false, "the drawn group fixture reads as an edit");
    assert.equal(holdsARecordedFact(DRAWN_KOSPIEL), false, "the drawn bracket fixture reads as an edit");
  });

  /* Over the DECLARED map rather than the parse: a parse that found nothing would run this loop zero
     times and stay green, and the comparison above is what binds the map to the backend anyway. */
  for (const [projected, edit] of Object.entries(RECORDED_EDITS)) {
    it(`closes the window on ${projected} — ${edit.why}`, () => {
      assert.equal(holdsARecordedFact({ ...DRAWN_GRUPPENSPIEL, ...edit.gruppe }), true, `${projected} left the group window open`);

      if (edit.ko !== undefined) {
        assert.equal(holdsARecordedFact({ ...DRAWN_KOSPIEL, ...edit.ko }), true, `${projected} left the bracket window open`);
      }
    });
  }
});
