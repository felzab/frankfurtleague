import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// Relative imports, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { applyDraftToSpiel, deriveSpielDraftStatus, isLevelKnockout } from "./draftStatus.ts";

import type { FLSpielDraftFields } from "./draftStatus.ts";
import type { FLSpiel, FLSpielTeamFieldJoined } from "./schemas.ts";
import type { ActionRequiredCategory } from "./types.ts";

const TEAM_1 = "6890a1b2c3d4e5f607182932";
const TEAM_2 = "6890a1b2c3d4e5f607182933";
const ORT = "6890a1b2c3d4e5f607182940";
const SCHIRI = "6890a1b2c3d4e5f607182950";

/** `disqualifikation` rides along because an endpoint joins it; nothing here asserts on it. */
const side = (team_id: string, name: string, shorthand: string, tore: number | null): FLSpielTeamFieldJoined => ({
  team_id,
  name,
  shorthand,
  tore,
  disqualifikation: null,
});

/** Fully populated, so every descriptor has something to compare against. */
function makeStored(overrides: Partial<FLSpiel> = {}): FLSpiel {
  return {
    id: "6890a1b2c3d4e5f607182900",
    spieltag_id: "6890a1b2c3d4e5f607182901",
    spiel_nr: 12,
    saison_id: "2026",
    saison_phase: "gruppenphase",
    is_canceled: false,
    datum: "2026-08-12",
    uhrzeit: "18:30:00",
    ort: { spielort_id: ORT, name: "Sportpark Nord", maps_link: "Sportpark Nord", mietpreis: 120 },
    schiedsrichter: { schiedsrichter_id: SCHIRI, name: "Pierluigi Collina", payment: 40 },
    team1: side(TEAM_1, "Team A", "TA", 3),
    team2: side(TEAM_2, "Team B", "TB", 1),
    team1_quelle: null,
    team2_quelle: null,
    ergebnis: "3:1",
    elfmeterschiessen: null,
    notiz: null,
    ...overrides,
  } as FLSpiel;
}

/** The draft the form holds when nothing has been touched: exactly the stored fields. */
function draftOf(stored: FLSpiel, overrides: Partial<FLSpielDraftFields> = {}): FLSpielDraftFields {
  return {
    datum: stored.datum,
    uhrzeit: stored.uhrzeit,
    ort: stored.ort,
    schiedsrichter: stored.schiedsrichter,
    team1: stored.team1,
    team2: stored.team2,
    team1_quelle: stored.team1_quelle,
    team2_quelle: stored.team2_quelle,
    elfmeterschiessen: stored.elfmeterschiessen,
    is_canceled: stored.is_canceled,
    notiz: stored.notiz,
    ...overrides,
  };
}

function derive(
  stored: FLSpiel,
  draft: FLSpielDraftFields,
  categories: readonly ActionRequiredCategory[] = [],
  fieldErrors: Record<string, string> = {},
) {
  return deriveSpielDraftStatus({ stored, draft, expectedCategories: new Set(categories), fieldErrors });
}

describe("deriveSpielDraftStatus · dirtiness", () => {
  it("reports nothing changed when the draft is the stored fixture", () => {
    const stored = makeStored();
    const status = derive(stored, draftOf(stored));

    assert.equal(status.isDirty, false);
    assert.deepEqual(status.changed, []);
  });

  it("reports a changed date with both its readings, formatted as the site formats them", () => {
    const stored = makeStored();
    const status = derive(stored, draftOf(stored, { datum: "2026-08-19" }));

    assert.equal(status.isDirty, true);
    assert.deepEqual(
      status.changed.map((field) => field.path),
      ["datum"],
    );
    assert.equal(status.byPath.get("datum")?.storedText, "12.08.2026");
    assert.equal(status.byPath.get("datum")?.draftText, "19.08.2026");
  });

  // A venue is a whole embedded object, so identity comparison would call every render a change.
  it("compares a venue by its id rather than by object identity", () => {
    const stored = makeStored();
    const sameVenueNewObject = { spielort_id: ORT, name: "Sportpark Nord", maps_link: "Sportpark Nord", mietpreis: 120 };

    assert.equal(derive(stored, draftOf(stored, { ort: sameVenueNewObject })).isDirty, false);
  });

  it("reports a venue swap and an emptied venue differently", () => {
    const stored = makeStored();
    const swapped = derive(
      stored,
      draftOf(stored, { ort: { spielort_id: "6890a1b2c3d4e5f607182941", name: "Riedwiese", maps_link: "Riedwiese", mietpreis: 90 } }),
    );
    const emptied = derive(stored, draftOf(stored, { ort: null }));

    assert.equal(swapped.byPath.get("ort.spielort_id")?.draftText, "Riedwiese");
    assert.equal(emptied.byPath.get("ort.spielort_id")?.draftText, null);
    assert.equal(emptied.byPath.get("ort.spielort_id")?.storedText, "Sportpark Nord");
  });

  // Two structurally equal sources must not read as a change; the objects are rebuilt on every pick.
  it("compares a bracket source by its contents", () => {
    const stored = makeStored({ saison_phase: "halbfinale", team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" } });

    assert.equal(derive(stored, draftOf(stored, { team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" } })).isDirty, false);
    assert.equal(derive(stored, draftOf(stored, { team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "verlierer" } })).isDirty, true);
    assert.equal(derive(stored, draftOf(stored, { team1_quelle: { type: "gruppe", gruppe: "A", platz: 1 } })).isDirty, true);
  });

  it("reads a cancellation in both directions, each state with its own word", () => {
    const going = makeStored();
    const called = makeStored({ is_canceled: true });

    assert.equal(derive(going, draftOf(going, { is_canceled: true })).byPath.get("is_canceled")?.draftText, "Abgesagt");
    // "Angesetzt", never `null`: a null draft value renders as an emptied field in the danger
    // grade, and putting a fixture back on is not an emptying.
    assert.equal(derive(called, draftOf(called, { is_canceled: false })).byPath.get("is_canceled")?.draftText, "Angesetzt");
    assert.equal(derive(called, draftOf(called, { is_canceled: false })).byPath.get("is_canceled")?.storedText, "Abgesagt");
  });

  // NaN is what a NumberField reports while a cleared box is being retyped, and NaN !== NaN.
  it("does not report a still-empty goal field as changed", () => {
    const stored = makeStored({ team1: side(TEAM_1, "Team A", "TA", null), ergebnis: null });
    const status = derive(stored, draftOf(stored, { team1: side(TEAM_1, "Team A", "TA", NaN) }));

    assert.equal(status.byPath.get("team1.tore")?.draftText, null);
    assert.equal(status.byPath.get("team1.tore")?.isChanged, false);
  });
});

describe("deriveSpielDraftStatus · what somebody is waiting on", () => {
  it("marks nothing when no category applies, however empty the fixture is", () => {
    const stored = makeStored({ datum: null, uhrzeit: null, ort: null, schiedsrichter: null });

    assert.deepEqual(derive(stored, draftOf(stored)).expected, []);
  });

  it("marks an empty field its category names", () => {
    const stored = makeStored({ datum: null });
    const status = derive(stored, draftOf(stored), ["datum_missing"]);

    assert.deepEqual(
      status.expected.map((field) => field.path),
      ["datum"],
    );
  });

  // The category set is frozen from the stored fixture while emptiness is live, which is what
  // makes a marker disappear as the admin fills the field rather than at the save.
  it("stops marking a field once the draft fills it, without the category changing", () => {
    const stored = makeStored({ datum: null });
    const status = derive(stored, draftOf(stored, { datum: "2026-08-19" }), ["datum_missing"]);

    assert.deepEqual(status.expected, []);
    assert.equal(status.byPath.get("datum")?.isChanged, true);
  });

  it("marks both goal fields for one missing result", () => {
    const stored = makeStored({
      team1: side(TEAM_1, "Team A", "TA", null),
      team2: side(TEAM_2, "Team B", "TB", null),
      ergebnis: null,
    });
    const status = derive(stored, draftOf(stored), ["ergebnis_pending"]);

    assert.deepEqual(
      status.expected.map((field) => field.path),
      ["team1.tore", "team2.tore"],
    );
  });

  // A side WITH a source and no team yet is correct; only "no team AND no source" is open.
  it("marks an unwired knockout side and leaves a wired one alone", () => {
    const unwired = makeStored({ saison_phase: "halbfinale", team1: null, team1_quelle: null, ergebnis: null });
    const wired = makeStored({
      saison_phase: "halbfinale",
      team1: null,
      team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" },
      ergebnis: null,
    });

    assert.deepEqual(
      derive(unwired, draftOf(unwired), ["besetzung_missing"]).expected.map((field) => field.path),
      ["team1_quelle"],
    );
    assert.deepEqual(derive(wired, draftOf(wired), ["besetzung_missing"]).expected, []);
  });

  // A hand-picked side has a team and no source: marking it would demand wiring for a slot the
  // admin deliberately took over.
  it("leaves a manually filled side alone", () => {
    const manual = makeStored({ saison_phase: "halbfinale", team1_quelle: null, ergebnis: null });

    assert.deepEqual(derive(manual, draftOf(manual), ["besetzung_missing"]).expected, []);
  });
});

describe("deriveSpielDraftStatus · rejected fields", () => {
  it("attaches a message to the field it names", () => {
    const stored = makeStored();
    const status = derive(stored, draftOf(stored), [], { "ort.mietpreis": "Bitte gib einen Mietpreis ein." });

    assert.equal(status.byPath.get("ort.mietpreis")?.error, "Bitte gib einen Mietpreis ein.");
    assert.deepEqual(
      status.invalid.map((field) => field.path),
      ["ort.mietpreis"],
    );
  });

  // A source reports failures under the variant's key, never `teamN_quelle`, so a descriptor
  // looking at only the latter counts zero rejected fields.
  it("finds a source's message under the variant key the schema uses", () => {
    const stored = makeStored({ saison_phase: "halbfinale", team1_quelle: { type: "gruppe", gruppe: "A", platz: 1 } });
    const status = derive(stored, draftOf(stored), [], { "team1_quelle.platz": "Bitte wähle einen Platz aus." });

    assert.equal(status.byPath.get("team1_quelle")?.error, "Bitte wähle einen Platz aus.");
  });

  it("reports no error when the map is empty", () => {
    const stored = makeStored();

    assert.deepEqual(derive(stored, draftOf(stored)).invalid, []);
  });
});

describe("deriveSpielDraftStatus · the table itself", () => {
  // Every editable field needs a row, or it is invisible to the markers, the change list and the
  // guard alike. A newly added one failing here is the point of the case.
  it("covers every field of the draft shape", () => {
    const stored = makeStored();
    const paths = new Set(derive(stored, draftOf(stored)).fields.map((field) => field.path));

    for (const expectedPath of [
      "datum",
      "uhrzeit",
      "ort.spielort_id",
      "ort.mietpreis",
      "schiedsrichter.schiedsrichter_id",
      "schiedsrichter.payment",
      "team1_quelle",
      "team1.team_id",
      "team2_quelle",
      "team2.team_id",
      "team1.tore",
      "team2.tore",
      "elfmeterschiessen.team1",
      "elfmeterschiessen.team2",
      "is_canceled",
    ]) {
      assert.ok(paths.has(expectedPath), `no descriptor for ${expectedPath}`);
    }
  });

  it("keys every field by its own path", () => {
    const stored = makeStored();
    const status = derive(stored, draftOf(stored));

    assert.equal(status.byPath.size, status.fields.length);
  });
});

describe("isLevelKnockout · the shape a shoot-out describes", () => {
  const level = (tore: number | null) => side(TEAM_1, "Team A", "TA", tore);
  const other = (tore: number | null) => side(TEAM_2, "Team B", "TB", tore);

  it("holds for a knockout fixture whose goals finished level", () => {
    assert.equal(isLevelKnockout("achtelfinale", level(2), other(2)), true);
  });

  // Each is a route out of the shape the editor's own handlers do NOT cover.
  it("does not hold once a goal edit unlevels the fixture", () => {
    assert.equal(isLevelKnockout("achtelfinale", level(3), other(2)), false);
  });

  it("does not hold once a side is cleared", () => {
    assert.equal(isLevelKnockout("achtelfinale", null, other(2)), false);
  });

  it("does not hold while a count is empty or mid-entry", () => {
    assert.equal(isLevelKnockout("achtelfinale", level(null), other(2)), false);
    assert.equal(isLevelKnockout("achtelfinale", level(NaN), other(NaN)), false);
  });

  // A group-phase draw is a final result worth a point to each side, whatever the goals are.
  it("never holds in the group phase", () => {
    assert.equal(isLevelKnockout("gruppenphase", level(2), other(2)), false);
  });
});

describe("applyDraftToSpiel · an orphaned shoot-out", () => {
  const knockout = () =>
    makeStored({
      saison_phase: "achtelfinale",
      team1: side(TEAM_1, "Team A", "TA", 2),
      team2: side(TEAM_2, "Team B", "TB", 2),
      ergebnis: "2:2",
      elfmeterschiessen: { team1: 5, team2: 4 },
    });

  it("keeps the record while the draft is still a level knockout", () => {
    const stored = knockout();

    assert.deepEqual(applyDraftToSpiel(stored, draftOf(stored)).elfmeterschiessen, { team1: 5, team2: 4 });
  });

  it("drops the record the moment the draft stops being one", () => {
    const stored = knockout();
    const unlevelled = draftOf(stored, { team1: side(TEAM_1, "Team A", "TA", 3) });

    assert.equal(applyDraftToSpiel(stored, unlevelled).elfmeterschiessen, null);
  });

  it("drops a half-entered record rather than sending one count", () => {
    const stored = knockout();

    assert.equal(applyDraftToSpiel(stored, draftOf(stored, { elfmeterschiessen: { team1: 5, team2: null } })).elfmeterschiessen, null);
  });
});

/**
 * Read from the source, a hook not being renderable here. It guards the shape of the retraction:
 * moved back into the toggle handlers, the atom would feed the draft unconditionally and a
 * shoot-out would reach the payload after its inputs had unmounted.
 */
describe("the match editor's draft", () => {
  const editor = readFileSync(path.resolve(import.meta.dirname, "components/forms/AdminEditSpielDataForm/AdminEditSpielDataForm.tsx"), "utf8");

  it("gates its shoot-out through isLevelKnockout rather than passing the atom straight in", () => {
    assert.ok(editor.includes("isLevelKnockout(spielData.saison_phase"), "the editor does not gate its shoot-out on isLevelKnockout");
    assert.ok(!/\n {4}elfmeterschiessen,\n/.test(editor), "the editor feeds the raw shoot-out atom into its draft");
  });
});
