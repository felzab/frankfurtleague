/** One side of a fixture, as the joined read shape carries it. */
export interface SpielSeite {
  team_id: string;
  tore: number | null;
  name: string;
  shorthand: string;
  austritt_type: string | null;
}

/**
 * Every field a fixture document carries.
 *
 * Typed structurally rather than off `FLSpielSchema`, which `shared` may not import
 * (`docs/frontend/spec.md` I9): the schema's parse stands at the call site and refuses the drift.
 */
export interface SpielFields {
  id: string;
  spieltag_id: string;
  team1: SpielSeite | null;
  team2: SpielSeite | null;
  team1_quelle: unknown;
  team2_quelle: unknown;
  datum: string | null;
  uhrzeit: string | null;
  ort: unknown;
  schiedsrichter: unknown;
  ergebnis: string | null;
  elfmeterschiessen: unknown;
  spiel_nr: number;
  sonderereignis: string | null;
  saison_phase: string;
  saison_id: string;
  notiz: string | null;
}

/** A club on one side of a fixture, scoring nothing and still in the league unless the caller says otherwise. */
export function seite(teamId: string, overrides: Partial<Omit<SpielSeite, "team_id">> = {}): SpielSeite {
  return { team_id: teamId, tore: null, name: "SV Beispiel", shorthand: "SV", austritt_type: null, ...overrides };
}

/**
 * A fixture landing in no category of its own: unplayed, unscheduled, in the group phase, with both
 * sides known.
 *
 * Every case knocks out the one field it is about, so what it exercises is the difference from here.
 */
export function spielFields(overrides: Partial<SpielFields> = {}): SpielFields {
  return {
    id: "6890a1b2c3d4e5f607182930",
    spieltag_id: "6890a1b2c3d4e5f607182931",
    team1: seite("6890a1b2c3d4e5f607182932", { name: "Team A", shorthand: "TA" }),
    team2: seite("6890a1b2c3d4e5f607182933", { name: "Team B", shorthand: "TB" }),
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
    saison_phase: "gruppenphase",
    saison_id: "2026",
    notiz: null,
    ...overrides,
  };
}
