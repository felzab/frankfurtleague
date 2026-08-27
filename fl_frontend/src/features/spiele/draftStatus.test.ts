import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

// Relative imports, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { admitsShootOut, applyDraftToSpiel, deriveSpielDraftStatus } from "./draftStatus.ts";

import type { FLSpielDraftFields } from "./draftStatus.ts";
import type { FLSpielAdmin, FLSpielTeamFieldJoined } from "./schemas.ts";
import type { ActionRequiredCategory } from "./types.ts";

const TEAM_1 = "6890a1b2c3d4e5f607182932";
const TEAM_2 = "6890a1b2c3d4e5f607182933";
const ORT = "6890a1b2c3d4e5f607182940";
const SCHIRI = "6890a1b2c3d4e5f607182950";

/** The joined withdrawal rides along because an endpoint joins it; nothing here asserts on it. */
const side = (team_id: string, name: string, shorthand: string, tore: number | null): FLSpielTeamFieldJoined => ({
  team_id,
  name,
  shorthand,
  tore,
  austritt_type: null,
});

/** Fully populated, so every descriptor has something to compare against. */
function makeStored(overrides: Partial<FLSpielAdmin> = {}): FLSpielAdmin {
  return {
    id: "6890a1b2c3d4e5f607182900",
    spieltag_id: "6890a1b2c3d4e5f607182901",
    spiel_nr: 12,
    saison_id: "2026",
    saison_phase: "gruppenphase",
    sonderereignis: null,
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
  } as FLSpielAdmin;
}

/** The draft the form holds when nothing has been touched: exactly the stored fields. */
function draftOf(stored: FLSpielAdmin, overrides: Partial<FLSpielDraftFields> = {}): FLSpielDraftFields {
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
    sonderereignis: stored.sonderereignis,
    notiz: stored.notiz,
    ...overrides,
  };
}

function derive(
  stored: FLSpielAdmin,
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

  it("gives every Sonderereignis its own word, the ordinary fixture included", () => {
    const going = makeStored();

    for (const [sonderereignis, label] of [
      ["ausgefallen", "Ausgefallen"],
      ["nichtantreten_team1", "Nichtantreten Team 1"],
      ["nichtantreten_team2", "Nichtantreten Team 2"],
      ["abgebrochen", "Abgebrochen"],
      ["annulliert", "Annulliert"],
    ] as const) {
      assert.equal(derive(going, draftOf(going, { sonderereignis })).byPath.get("sonderereignis")?.draftText, label);
    }

    // "Regulär", never `null`: a null draft value renders as an emptied field in the danger grade,
    // and putting a fixture back on is not an emptying.
    const called = makeStored({ sonderereignis: "ausgefallen" });
    assert.equal(derive(called, draftOf(called, { sonderereignis: null })).byPath.get("sonderereignis")?.draftText, "Regulär");
    assert.equal(derive(called, draftOf(called, { sonderereignis: null })).byPath.get("sonderereignis")?.storedText, "Ausgefallen");
  });

  // Swapping one member for another is an edit, and the boolean this replaced could not express it.
  it("reports a change from one Sonderereignis to another", () => {
    const called = makeStored({ sonderereignis: "ausgefallen" });

    assert.equal(derive(called, draftOf(called, { sonderereignis: "annulliert" })).isDirty, true);
    assert.equal(derive(called, draftOf(called, { sonderereignis: "ausgefallen" })).isDirty, false);
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

  /* The four scheduling fields are one grade, decided 2026-08-26. Nothing else pins which side a
     category falls on, so a silent move would recolour the editor's markers and leave the sentence
     beside them false. */
  it("grades the four scheduling fields alike, and apart from what leaves a fixture unscoreable", () => {
    const bare = makeStored({ datum: null, uhrzeit: null, ort: null, schiedsrichter: null });
    const scheduling = derive(bare, draftOf(bare), ["datum_missing", "uhrzeit_missing", "ort_missing", "schiedsrichter_missing"]);

    assert.deepEqual(
      scheduling.expected.map((field) => [field.path, field.expectedSeverity]),
      [
        ["datum", "scheduling"],
        ["uhrzeit", "scheduling"],
        ["ort.spielort_id", "scheduling"],
        ["schiedsrichter.schiedsrichter_id", "scheduling"],
      ],
    );

    const unscoreable = makeStored({ saison_phase: "halbfinale", team1: null, team1_quelle: null, team2: null, ergebnis: null });
    const scoring = derive(unscoreable, draftOf(unscoreable), ["besetzung_missing", "ergebnis_pending"]);

    assert.deepEqual(new Set(scoring.expected.map((field) => field.expectedSeverity)), new Set(["scoring"]));
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
      "sonderereignis",
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

describe("admitsShootOut · the fixture a shoot-out belongs to", () => {
  const level = (tore: number | null) => side(TEAM_1, "Team A", "TA", tore);
  const other = (tore: number | null) => side(TEAM_2, "Team B", "TB", tore);

  it("holds for a knockout fixture whose goals finished level", () => {
    assert.equal(admitsShootOut("achtelfinale", level(2), other(2), null), true);
  });

  // Each is a route out of the shape the editor's own handlers do NOT cover.
  it("does not hold once a goal edit unlevels the fixture", () => {
    assert.equal(admitsShootOut("achtelfinale", level(3), other(2), null), false);
  });

  it("does not hold once a side is cleared", () => {
    assert.equal(admitsShootOut("achtelfinale", null, other(2), null), false);
  });

  it("does not hold while a count is empty or mid-entry", () => {
    assert.equal(admitsShootOut("achtelfinale", level(null), other(2), null), false);
    assert.equal(admitsShootOut("achtelfinale", level(NaN), other(NaN), null), false);
  });

  // A group-phase draw is a final result worth a point to each side, whatever the goals are.
  it("never holds in the group phase", () => {
    assert.equal(admitsShootOut("gruppenphase", level(2), other(2), null), false);
  });

  // The typed goals are NOT the result under a no-show: the server composes it from the season's
  // `forfeit_ergebnis`, which a grandfathered season may regulate as a draw.
  it("never holds beside a Nichtantreten, however level the typed goals are", () => {
    for (const sonderereignis of ["nichtantreten_team1", "nichtantreten_team2"] as const) {
      assert.equal(admitsShootOut("achtelfinale", level(2), other(2), sonderereignis), false, sonderereignis);
    }
  });

  // The three that leave the goals alone: the result is the typed one, so the fixture keeps its tie.
  it("still holds under an event the server scores from the typed goals", () => {
    for (const sonderereignis of ["ausgefallen", "abgebrochen", "annulliert"] as const) {
      assert.equal(admitsShootOut("achtelfinale", level(2), other(2), sonderereignis), true, sonderereignis);
    }
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

  // The award is composed from the season's rules and may itself be level, so the write path
  // discards the record on the EVENT; a preview keeping it would promise what that save throws away.
  it("drops the record under a Nichtantreten, however level the typed goals are", () => {
    const stored = knockout();

    for (const sonderereignis of ["nichtantreten_team1", "nichtantreten_team2"] as const) {
      assert.equal(applyDraftToSpiel(stored, draftOf(stored, { sonderereignis })).elfmeterschiessen, null, sonderereignis);
    }
  });
});

/**
 * **The preview mirrors `fl_backend/app/api/spiele/services.py :: apply_payload_to_spiel`**, and the
 * one place it cannot is the forfeit: those goals are composed there from the season's rules, which
 * this page never loads.
 */
describe("applyDraftToSpiel · what a Sonderereignis does to the result", () => {
  it("states no result under a Nichtantreten rather than the typed one the save replaces", () => {
    const stored = makeStored();

    for (const sonderereignis of ["nichtantreten_team1", "nichtantreten_team2"] as const) {
      assert.equal(applyDraftToSpiel(stored, draftOf(stored, { sonderereignis })).ergebnis, null, sonderereignis);
    }
  });

  // NOT emptied here: `find_state_refusal` answers `REQ-STATE-002` and REFUSES the save, so a preview
  // that quietly cleared the goals would hide the very contradiction the banner reports.
  it("leaves the typed result standing under an event that cannot carry one", () => {
    const stored = makeStored();

    for (const sonderereignis of ["ausgefallen", "annulliert"] as const) {
      assert.equal(applyDraftToSpiel(stored, draftOf(stored, { sonderereignis })).ergebnis, "3:1", sonderereignis);
    }
  });

  it("leaves an abandoned fixture's result exactly as entered", () => {
    const stored = makeStored();

    assert.equal(applyDraftToSpiel(stored, draftOf(stored, { sonderereignis: "abgebrochen" })).ergebnis, "3:1");
  });
});

/**
 * Read from the source, a hook not being renderable here. It guards the shape of the retraction:
 * moved back into the toggle handlers, the atom would feed the draft unconditionally and a
 * shoot-out would reach the payload after its inputs had unmounted.
 */
describe("the match editor's draft", () => {
  const from = (file: string) => readFileSync(path.resolve(import.meta.dirname, "components/forms/AdminEditSpielDataForm", file), "utf8");
  const editor = from("AdminEditSpielDataForm.tsx");
  const ergebnisPanel = from("FormErgebnisSection.tsx");

  it("gates its shoot-out through admitsShootOut rather than passing the atom straight in", () => {
    assert.ok(
      editor.includes("admitsShootOut(spielData.saison_phase, team1Payload, team2Payload, sonderereignis)"),
      "the editor does not gate its shoot-out on the whole condition",
    );
    assert.ok(!/\n {4}elfmeterschiessen,\n/.test(editor), "the editor feeds the raw shoot-out atom into its draft");
  });

  // The defect this pair is here to prevent: a form offering the control on part of the condition
  // submits counts the panel never showed and the write path throws away.
  it("offers the control on the same condition the draft retracts by, event included", () => {
    assert.ok(
      ergebnisPanel.includes("admitsShootOut(spielData.saison_phase, team1Payload, team2Payload, sonderereignis)"),
      "the Ergebnis panel does not offer its shoot-out on the whole condition",
    );
  });
});
