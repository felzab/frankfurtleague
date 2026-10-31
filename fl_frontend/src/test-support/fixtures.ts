import type {
  FLSpielbestaetigung,
  FLSpielJoined,
  FLSpielSchiedsrichterField,
  FLSpielSchiedsrichterFieldPublic,
  FLSpielTeamFieldJoined,
} from "@/core/generated/client/types";

/** One side of a fixture, as the joined read shape carries it. */
type SpielSide = FLSpielTeamFieldJoined;

/**
 * Every field a fixture read carries, of either tier: the referee's id is the admin tier's alone. The shape of
 * `fl_frontend/src/features/spiele/types.ts :: FLSpiel`, which `shared` may not import.
 */
type SpielFields = Omit<FLSpielJoined, "schiedsrichter"> & {
  schiedsrichter:
    | (Pick<FLSpielSchiedsrichterFieldPublic, "name"> &
        Partial<Pick<FLSpielSchiedsrichterFieldPublic, "name_is_public"> & Pick<FLSpielSchiedsrichterField, "schiedsrichter_id">>)
    | null;
};

/** A club on one side of a fixture, scoring nothing and still in the league unless the caller says otherwise. */
export function side(teamId: string, overrides: Partial<Omit<SpielSide, "team_id">> = {}): SpielSide {
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
    team1: side("6890a1b2c3d4e5f607182932", { name: "Team A", shorthand: "TA" }),
    team2: side("6890a1b2c3d4e5f607182933", { name: "Team B", shorthand: "TB" }),
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
    ansetzung_confirmed: null,
    ...overrides,
  };
}

/**
 * Team 1's open row about `spielFields`' fixture dated 2026-08-05 at 18:00 on no ground. A case dates the fixture to
 * match, or moves one input to make the row about an Ansetzung the fixture left.
 */
export function spielbestaetigungFields(overrides: Partial<FLSpielbestaetigung> = {}): FLSpielbestaetigung {
  return {
    id: "6890a1b2c3d4e5f607182a01",
    saison_id: "2026",
    spiel_id: "6890a1b2c3d4e5f607182930",
    party: { art: "team", team_id: "6890a1b2c3d4e5f607182932" },
    ansetzung: {
      datum: "2026-08-05",
      uhrzeit: "18:00:00",
      spielort_id: null,
      team1_id: "6890a1b2c3d4e5f607182932",
      team2_id: "6890a1b2c3d4e5f607182933",
      stand: "0".repeat(64),
    },
    frist: "2026-07-29",
    asked_at: "2026-07-29",
    reminded_at: [],
    kontakte: { trainer: { delivery: null }, ansprechperson: { delivery: null }, stellvertretung: null },
    antwort: null,
    closed: null,
    ...overrides,
  };
}
