/**
 * A fixture's report as the backend serves it to either reader. Untyped, `shared` naming no slice's schema
 * (`docs/frontend/spec.md` I9): a typed suite parses it through its mirror.
 */

export const BERICHT_SPIEL_ID = "68c1f0a2b3c4d5e6f7a8b9e2";
const TORSCHUETZIN_ID = "68c1f0a2b3c4d5e6f7a8b9f1";
const GELB_ID = "68c1f0a2b3c4d5e6f7a8b9f2";
const TEAM1_ID = "68c1f0a2b3c4d5e6f7a8b9a1";
const TEAM2_ID = "68c1f0a2b3c4d5e6f7a8b9a2";

/** A stored block of a 1:0: one named scorer for team 1 and a yellow on team 2, as a referee submitted it. */
const berichtFixture = (overrides: Record<string, unknown> = {}) => ({
  ergebnis_vorschlag: { team1_tore: 1, team2_tore: 0, elfmeterschiessen: null, sonderereignis: null },
  torschuetzen: [{ seite: "team1", spieler_id: TORSCHUETZIN_ID, minute: "23", eigentor: false }],
  karten: [{ seite: "team2", spieler_id: GELB_ID, minute: "61", farbe: "gelb", grund: "foulspiel" }],
  bemerkungen: "Spiel zehn Minuten wegen Gewitter unterbrochen.",
  // The clubs the read below fields.
  seiten: { team1: TEAM1_ID, team2: TEAM2_ID },
  eingereicht_am: "2026-10-17T17:00:00Z",
  eingereicht_von: { art: "schiedsrichter", schiedsrichter_id: "68c1f0a2b3c4d5e6f7a8b9d1" },
  geaendert_am: "2026-10-17T17:00:00Z",
  version: 1,
  uebernommen_am: null,
  uebernommen_von: null,
  uebernommene_version: null,
  ...overrides,
});

/** One fixture's report read, both readers' shape: the fixture played, both squads, and the block above. */
export const spielberichtReadFixture = (overrides: Record<string, unknown> = {}) => ({
  acknowledged: 1,
  spiel: {
    spiel_id: BERICHT_SPIEL_ID,
    saison_id: "2026",
    saison_phase: "gruppenphase",
    datum: "2026-10-17",
    uhrzeit: "15:00:00",
    team1: { team_id: TEAM1_ID, name: "Goethe-Gymnasium" },
    team2: { team_id: TEAM2_ID, name: "Lessing-Gymnasium" },
    sonderereignis: null,
  },
  kader: {
    team1: [{ spieler_id: TORSCHUETZIN_ID, vorname: "Lina", nachname: "Berg", nummer: "9" }],
    team2: [{ spieler_id: GELB_ID, vorname: "Jonas", nachname: "Keller", nummer: "4" }],
  },
  genannt: [],
  bericht: berichtFixture(),
  seiten_geaendert: [],
  zustand: "vorgeschlagen",
  ...overrides,
});
