import type {
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
    for_third_place: false,
    ...overrides,
  };
}
