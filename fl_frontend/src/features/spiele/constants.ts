import type { FLSonderereignis } from "./schemas";

/**
 * The one German spelling of each Sonderereignis. **A label table and never a predicate**: what a
 * member means differs per consumer, and each of those sets is written at its own call site.
 */
export const SONDEREREIGNIS_LABELS: Record<FLSonderereignis, string> = {
  ausgefallen: "Ausgefallen",
  nichtantreten_team1: "Nichtantreten Team 1",
  nichtantreten_team2: "Nichtantreten Team 2",
  abgebrochen: "Abgebrochen",
  annulliert: "Annulliert",
};

/**
 * The word for a fixture carrying no event. Its own constant rather than a `null` key above: `null`
 * is the absence of an event, not a sixth one that a consumer could iterate.
 */
export const SONDEREREIGNIS_NONE_LABEL = "Regulär";

/**
 * Declaration order is the order the editor's control and the filter offer them — how often an admin
 * reaches for one, ending with the member that strikes a fixture from the record altogether.
 */
export const SONDEREREIGNIS_OPTIONS: readonly FLSonderereignis[] = [
  "ausgefallen",
  "nichtantreten_team1",
  "nichtantreten_team2",
  "abgebrochen",
  "annulliert",
];
