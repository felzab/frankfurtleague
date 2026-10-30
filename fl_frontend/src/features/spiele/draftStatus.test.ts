// Relative imports, not the "@/" alias: Node's resolver does not read tsconfig paths.
import { assert, describe, expect, it } from "vitest";

import { admitsShootOut, applyDraftToSpiel, deriveSpielDraftStatus } from "./draftStatus.ts";

import type { FLSpielJoinedAdmin, FLSpielTeamFieldJoined } from "@/core/generated/client/types";
import type { FLSpielDraftFields } from "./draftStatus.ts";
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
const STORED: FLSpielJoinedAdmin = {
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
  ansetzung_bestaetigt: null,
  version: 1,
};

function makeStored(overrides: Partial<FLSpielJoinedAdmin> = {}): FLSpielJoinedAdmin {
  return { ...STORED, ...overrides };
}

/** The draft the form holds when nothing has been touched: exactly the stored fields. */
function draftOf(stored: FLSpielJoinedAdmin, overrides: Partial<FLSpielDraftFields> = {}): FLSpielDraftFields {
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
  stored: FLSpielJoinedAdmin,
  draft: FLSpielDraftFields,
  categories: readonly ActionRequiredCategory[] = [],
  fieldErrors: Record<string, string> = {},
) {
  return deriveSpielDraftStatus({ stored, draft, uebernimmtBericht: null, expectedCategories: new Set(categories), fieldErrors });
}

describe("deriveSpielDraftStatus · dirtiness", () => {
  it("reports nothing changed when the draft is the stored fixture", () => {
    const stored = makeStored();
    const status = derive(stored, draftOf(stored));

    expect(status.isDirty).toBe(false);
    expect(status.changed).toStrictEqual([]);
  });

  it("reports a changed date with both its readings, formatted as the site formats them", () => {
    const stored = makeStored();
    const status = derive(stored, draftOf(stored, { datum: "2026-08-19" }));

    expect(status.isDirty).toBe(true);
    expect(status.changed.map((field) => field.path)).toStrictEqual(["datum"]);
    expect(status.byPath.get("datum")?.storedText).toBe("12.08.2026");
    expect(status.byPath.get("datum")?.draftText).toBe("19.08.2026");
  });

  // A venue is a whole embedded object, so identity comparison would call every render a change.
  it("compares a venue by its id rather than by object identity", () => {
    const stored = makeStored();
    const sameVenueNewObject = { spielort_id: ORT, name: "Sportpark Nord", maps_link: "Sportpark Nord", mietpreis: 120 };

    expect(derive(stored, draftOf(stored, { ort: sameVenueNewObject })).isDirty).toBe(false);
  });

  it("reports a venue swap and an emptied venue differently", () => {
    const stored = makeStored();
    const swapped = derive(
      stored,
      draftOf(stored, { ort: { spielort_id: "6890a1b2c3d4e5f607182941", name: "Riedwiese", maps_link: "Riedwiese", mietpreis: 90 } }),
    );
    const emptied = derive(stored, draftOf(stored, { ort: null }));

    expect(swapped.byPath.get("ort.spielort_id")?.draftText).toBe("Riedwiese");
    expect(emptied.byPath.get("ort.spielort_id")?.draftText).toBe(null);
    expect(emptied.byPath.get("ort.spielort_id")?.storedText).toBe("Sportpark Nord");
  });

  // Two structurally equal sources must not read as a change; the objects are rebuilt on every pick.
  it("compares a bracket source by its contents", () => {
    const stored = makeStored({ saison_phase: "halbfinale", team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" } });

    expect(derive(stored, draftOf(stored, { team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "sieger" } })).isDirty).toBe(false);
    expect(derive(stored, draftOf(stored, { team1_quelle: { type: "spiel", spiel_nr: 25, ausgang: "verlierer" } })).isDirty).toBe(true);
    expect(derive(stored, draftOf(stored, { team1_quelle: { type: "gruppe", gruppe: "A", platz: 1 } })).isDirty).toBe(true);
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
      expect(derive(going, draftOf(going, { sonderereignis })).byPath.get("sonderereignis")?.draftText).toBe(label);
    }

    // "Regulär", never `null`: a null draft value renders as an emptied field in the danger grade,
    // and putting a fixture back on is not an emptying.
    const called = makeStored({ sonderereignis: "ausgefallen" });
    expect(derive(called, draftOf(called, { sonderereignis: null })).byPath.get("sonderereignis")?.draftText).toBe("Regulär");
    expect(derive(called, draftOf(called, { sonderereignis: null })).byPath.get("sonderereignis")?.storedText).toBe("Ausgefallen");
  });

  // Swapping one member for another is an edit, and the boolean this replaced could not express it.
  it("reports a change from one Sonderereignis to another", () => {
    const called = makeStored({ sonderereignis: "ausgefallen" });

    expect(derive(called, draftOf(called, { sonderereignis: "annulliert" })).isDirty).toBe(true);
    expect(derive(called, draftOf(called, { sonderereignis: "ausgefallen" })).isDirty).toBe(false);
  });

  // An emptied goal box records `null`, the stored fixture's own spelling of no goals.
  it("does not report a still-empty goal field as changed", () => {
    const stored = makeStored({ team1: side(TEAM_1, "Team A", "TA", null), ergebnis: null });
    const status = derive(stored, draftOf(stored, { team1: side(TEAM_1, "Team A", "TA", null) }));

    expect(status.byPath.get("team1.tore")?.draftText).toBe(null);
    expect(status.byPath.get("team1.tore")?.isChanged).toBe(false);
  });
});

describe("deriveSpielDraftStatus · what somebody is waiting on", () => {
  it("marks nothing when no category applies, however empty the fixture is", () => {
    const stored = makeStored({ datum: null, uhrzeit: null, ort: null, schiedsrichter: null });

    expect(derive(stored, draftOf(stored)).expected).toStrictEqual([]);
  });

  it("marks an empty field its category names", () => {
    const stored = makeStored({ datum: null });
    const status = derive(stored, draftOf(stored), ["datum_missing"]);

    expect(status.expected.map((field) => field.path)).toStrictEqual(["datum"]);
  });

  // The category set is frozen from the stored fixture while emptiness is live, which is what
  // makes a marker disappear as the admin fills the field rather than at the save.
  it("stops marking a field once the draft fills it, without the category changing", () => {
    const stored = makeStored({ datum: null });
    const status = derive(stored, draftOf(stored, { datum: "2026-08-19" }), ["datum_missing"]);

    expect(status.expected).toStrictEqual([]);
    expect(status.byPath.get("datum")?.isChanged).toBe(true);
  });

  it("marks both goal fields for one missing result", () => {
    const stored = makeStored({
      team1: side(TEAM_1, "Team A", "TA", null),
      team2: side(TEAM_2, "Team B", "TB", null),
      ergebnis: null,
    });
    const status = derive(stored, draftOf(stored), ["ergebnis_pending"]);

    expect(status.expected.map((field) => field.path)).toStrictEqual(["team1.tore", "team2.tore"]);
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

    expect(derive(unwired, draftOf(unwired), ["besetzung_missing"]).expected.map((field) => field.path)).toStrictEqual(["team1_quelle"]);
    expect(derive(wired, draftOf(wired), ["besetzung_missing"]).expected).toStrictEqual([]);
  });

  // A hand-picked side has a team and no source: marking it would demand wiring for a slot the
  // admin deliberately took over.
  it("leaves a manually filled side alone", () => {
    const manual = makeStored({ saison_phase: "halbfinale", team1_quelle: null, ergebnis: null });

    expect(derive(manual, draftOf(manual), ["besetzung_missing"]).expected).toStrictEqual([]);
  });

  /* The four scheduling fields are one grade. Nothing else pins which side a category falls on, so a
     silent move would recolour the editor's markers and leave the sentence beside them false. */
  it("grades the four scheduling fields alike, and apart from what leaves a fixture unscoreable", () => {
    const bare = makeStored({ datum: null, uhrzeit: null, ort: null, schiedsrichter: null });
    const scheduling = derive(bare, draftOf(bare), ["datum_missing", "uhrzeit_missing", "ort_missing", "schiedsrichter_missing"]);

    expect(scheduling.expected.map((field) => [field.path, field.expectedSeverity])).toStrictEqual([
      ["datum", "scheduling"],
      ["uhrzeit", "scheduling"],
      ["ort.spielort_id", "scheduling"],
      ["schiedsrichter.schiedsrichter_id", "scheduling"],
    ]);

    const unscoreable = makeStored({ saison_phase: "halbfinale", team1: null, team1_quelle: null, team2: null, ergebnis: null });
    const scoring = derive(unscoreable, draftOf(unscoreable), ["besetzung_missing", "ergebnis_pending"]);

    expect(new Set(scoring.expected.map((field) => field.expectedSeverity))).toStrictEqual(new Set(["scoring"]));
  });
});

describe("deriveSpielDraftStatus · rejected fields", () => {
  it("attaches a message to the field it names", () => {
    const stored = makeStored();
    const status = derive(stored, draftOf(stored), [], { "ort.mietpreis": "Bitte gib einen Mietpreis ein." });

    expect(status.byPath.get("ort.mietpreis")?.error).toBe("Bitte gib einen Mietpreis ein.");
    expect(status.invalid.map((field) => field.path)).toStrictEqual(["ort.mietpreis"]);
  });

  // A source reports failures under the variant's key, never `teamN_quelle`, so a descriptor
  // looking at only the latter counts zero rejected fields.
  it("finds a source's message under the variant key the schema uses", () => {
    const stored = makeStored({ saison_phase: "halbfinale", team1_quelle: { type: "gruppe", gruppe: "A", platz: 1 } });
    const status = derive(stored, draftOf(stored), [], { "team1_quelle.platz": "Bitte wähle einen Platz aus." });

    expect(status.byPath.get("team1_quelle")?.error).toBe("Bitte wähle einen Platz aus.");
  });

  it("reports no error when the map is empty", () => {
    const stored = makeStored();

    expect(derive(stored, draftOf(stored)).invalid).toStrictEqual([]);
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

    expect(status.byPath.size).toBe(status.fields.length);
  });
});

describe("admitsShootOut · the fixture a shoot-out belongs to", () => {
  const level = (tore: number | null) => side(TEAM_1, "Team A", "TA", tore);
  const other = (tore: number | null) => side(TEAM_2, "Team B", "TB", tore);

  it("holds for a knockout fixture whose goals finished level", () => {
    expect(admitsShootOut("achtelfinale", level(2), other(2), null)).toBe(true);
  });

  // Each is a route out of the shape the editor's own handlers do NOT cover.
  it("does not hold once a goal edit unlevels the fixture", () => {
    expect(admitsShootOut("achtelfinale", level(3), other(2), null)).toBe(false);
  });

  it("does not hold once a side is cleared", () => {
    expect(admitsShootOut("achtelfinale", null, other(2), null)).toBe(false);
  });

  it("does not hold while a count is empty", () => {
    expect(admitsShootOut("achtelfinale", level(null), other(2), null)).toBe(false);
  });

  // A group-phase draw is a final result worth a point to each side, whatever the goals are.
  it("never holds in the group phase", () => {
    expect(admitsShootOut("gruppenphase", level(2), other(2), null)).toBe(false);
  });

  // The typed goals are NOT the result under a no-show: the server composes it from the season's
  // `forfeit_ergebnis`, which a grandfathered season may regulate as a draw.
  it("never holds beside a Nichtantreten, however level the typed goals are", () => {
    for (const sonderereignis of ["nichtantreten_team1", "nichtantreten_team2"] as const) {
      expect(admitsShootOut("achtelfinale", level(2), other(2), sonderereignis), sonderereignis).toBe(false);
    }
  });

  // The three that leave the goals alone: the result is the typed one, so the fixture keeps its tie.
  it("still holds under an event the server scores from the typed goals", () => {
    for (const sonderereignis of ["ausgefallen", "abgebrochen", "annulliert"] as const) {
      expect(admitsShootOut("achtelfinale", level(2), other(2), sonderereignis), sonderereignis).toBe(true);
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

    expect(applyDraftToSpiel(stored, draftOf(stored)).elfmeterschiessen).toStrictEqual({ team1: 5, team2: 4 });
  });

  it("drops the record the moment the draft stops being one", () => {
    const stored = knockout();
    const unlevelled = draftOf(stored, { team1: side(TEAM_1, "Team A", "TA", 3) });

    expect(applyDraftToSpiel(stored, unlevelled).elfmeterschiessen).toBe(null);
  });

  it("drops a half-entered record rather than sending one count", () => {
    const stored = knockout();

    expect(applyDraftToSpiel(stored, draftOf(stored, { elfmeterschiessen: { team1: 5, team2: null } })).elfmeterschiessen).toBe(null);
  });

  // The award is composed from the season's rules and may itself be level, so the write path
  // discards the record on the EVENT; a preview keeping it would promise what that save throws away.
  it("drops the record under a Nichtantreten, however level the typed goals are", () => {
    const stored = knockout();

    for (const sonderereignis of ["nichtantreten_team1", "nichtantreten_team2"] as const) {
      expect(applyDraftToSpiel(stored, draftOf(stored, { sonderereignis })).elfmeterschiessen, sonderereignis).toBe(null);
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
      expect(applyDraftToSpiel(stored, draftOf(stored, { sonderereignis })).ergebnis, sonderereignis).toBe(null);
    }
  });

  // NOT emptied here: `find_state_refusal` answers `state_ergebnis_on_a_non_event` and REFUSES the save, so a preview
  // that quietly cleared the goals would hide the very contradiction the banner reports.
  it("leaves the typed result standing under an event that cannot carry one", () => {
    const stored = makeStored();

    for (const sonderereignis of ["ausgefallen", "annulliert"] as const) {
      expect(applyDraftToSpiel(stored, draftOf(stored, { sonderereignis })).ergebnis, sonderereignis).toBe("3:1");
    }
  });

  it("leaves an abandoned fixture's result exactly as entered", () => {
    const stored = makeStored();

    expect(applyDraftToSpiel(stored, draftOf(stored, { sonderereignis: "abgebrochen" })).ergebnis).toBe("3:1");
  });
});
