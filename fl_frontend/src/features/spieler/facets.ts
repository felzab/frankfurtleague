/**
 * SPIELER · what the admin player list can be narrowed by
 *
 * Module scope is load-bearing — see `TEAM_FACETS` for why, and for the reason a facet is a function
 * rather than a string.
 *
 * **The team facet is built per call**, because its options are the SELECTED SEASON's clubs rather than a
 * closed set: a filter offering a club that plays in another season would narrow to nothing and read as a
 * defect. `AdminSpielerView` memoises the result on the team list's identity, which is what keeps the
 * array stable across renders.
 */

import { POSITION_OPTIONS, STUFE_OPTIONS } from "./constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminSpielerRow, SpielerTeamOption } from "./types";

/**
 * The facets that need nothing from the page. Declared once, at module scope.
 *
 * Exported under the `*_FACETS` name every slice uses so `facets.test.ts` discovers it: that suite walks
 * `src/features/*​/facets.ts` and checks every facet set in the app for a reserved parameter, a duplicate
 * parameter and an unlabelled option. The team facet below is checked by the same file through a separate
 * call to the builder.
 */
export const SPIELER_FACETS: readonly Facet<AdminSpielerRow>[] = [
  {
    param: "kader",
    label: "Kader",
    options: [
      { value: "im_kader", label: "In einem Kader" },
      { value: "ohne_kader", label: "Ohne Kadereintrag" },
      { value: "ausgetragen", label: "Ausgetragen" },
    ],
    // Three states rather than two: a player with no row at all is a different fact from one whose row was
    // retired, and the second keeps its number, position and stufe (ADR-0032).
    read: (spieler) => {
      if (spieler.selected === null) return ["ohne_kader"];
      return spieler.selected.inactive_since === null ? ["im_kader"] : ["ausgetragen"];
    },
  },
  {
    param: "position",
    label: "Position",
    options: POSITION_OPTIONS.map((position) => ({ value: position, label: position })),
    read: (spieler) => (spieler.selected?.position == null ? [] : [spieler.selected.position]),
  },
  {
    param: "stufe",
    label: "Stufe",
    // The LEAGUE's six rather than the season's `erlaubte_stufen`: a squad row's level is held to the
    // league's closed set, so a season narrowed after the fact still has rows carrying a level it no
    // longer offers — and those are exactly the rows somebody would want to find (ADR-0061).
    options: STUFE_OPTIONS.map((stufe) => ({ value: stufe, label: stufe })),
    read: (spieler) => (spieler.selected?.stufe == null ? [] : [spieler.selected.stufe]),
  },
  {
    param: "rolle",
    label: "Rolle",
    options: [
      { value: "kapitaen", label: "Kapitän" },
      { value: "nachgetragen", label: "Nachgetragen" },
    ],
    // Both are properties of the squad row and neither excludes the other, so an item can match both.
    read: (spieler) => {
      const held: string[] = [];
      if (spieler.selected?.is_captain) held.push("kapitaen");
      if (spieler.selected?.is_nachgetragen) held.push("nachgetragen");
      return held;
    },
  },
  {
    param: "status",
    label: "Person",
    options: [
      { value: "aktiv", label: "Aktiv" },
      { value: "stillgelegt", label: "Stillgelegt" },
    ],
    // The PERSON's own retirement, which is independent of the squad row's above (ADR-0032). Labelled
    // „Person“ rather than „Status“ so the two facets cannot be read as the same question.
    read: (spieler) => [spieler.inactive_since === null ? "aktiv" : "stillgelegt"],
  },
];

/**
 * Every facet, with the team list folded in.
 *
 * Called from a `useMemo` keyed on `teams`, so the returned array is stable for as long as the season's
 * clubs are — which is what `AdminCrudView`'s collection-identity constraint requires.
 */
export function buildSpielerFacets(teams: readonly SpielerTeamOption[]): readonly Facet<AdminSpielerRow>[] {
  if (teams.length === 0) return SPIELER_FACETS;

  const teamFacet: Facet<AdminSpielerRow> = {
    param: "team",
    label: "Team",
    options: teams.map((team) => ({ value: team.teamId, label: team.name })),
    read: (spieler) => (spieler.selected === null ? [] : [spieler.selected.team_id]),
  };

  // The team first: it is the narrowing an admin reaches for most often, and a popover reads top down.
  return [teamFacet, ...SPIELER_FACETS];
}
