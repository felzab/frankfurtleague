import { POSITION_OPTIONS, ROLLE_OPTIONS, STUFE_OPTIONS } from "./constants";

import type { Facet } from "@/shared/utils/facets";
import type { AdminSpielerRow, SpielerTeamOption } from "./types";

/** The facets that need nothing from the page. */
export const SPIELER_FACETS: readonly Facet<AdminSpielerRow>[] = [
  {
    param: "kader",
    label: "Kader",
    options: [
      { value: "im_kader", label: "Im Kader" },
      { value: "ohne_kader", label: "Nicht im Kader" },
      { value: "ausgetragen", label: "Ausgetragen" },
    ],
    // The rows are every player in every season, so unnarrowed the list answers a question almost
    // nobody arrives with. The sidemenu's season is the one an admin came here about.
    defaultValues: ["im_kader"],
    // Three states, not two: no row at all is a different fact from a retired row, which keeps its
    // number, position and stufe.
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
    // The league's set rather than the season's `erlaubte_stufen`: a season narrowed after the fact
    // still has rows carrying a level it no longer offers.
    options: STUFE_OPTIONS.map((stufe) => ({ value: stufe, label: stufe })),
    read: (spieler) => (spieler.selected?.stufe == null ? [] : [spieler.selected.stufe]),
  },
  {
    param: "rolle",
    label: "Rolle",
    options: [
      ...ROLLE_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
      { value: "nachgetragen", label: "Nachgetragen" },
    ],
    read: (spieler) => {
      const held: string[] = [];
      if (spieler.selected?.rolle != null) held.push(spieler.selected.rolle);
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
    // The PERSON's own retirement, independent of the row's above — hence the „Person“ label, so the
    // two facets cannot be read as the same question.
    read: (spieler) => [spieler.inactive_since === null ? "aktiv" : "stillgelegt"],
  },
];

/**
 * Built per call: the team facet's options are the SELECTED SEASON's clubs.
 *
 * Looked up BY NAME in `fl_frontend/src/shared/utils/facets.test.ts`; a rename drops the team facet
 * from the checks silently.
 */
export function buildSpielerFacets(teams: readonly SpielerTeamOption[]): readonly Facet<AdminSpielerRow>[] {
  if (teams.length === 0) return SPIELER_FACETS;

  const teamFacet: Facet<AdminSpielerRow> = {
    param: "team",
    label: "Team",
    options: teams.map((team) => ({ value: team.teamId, label: team.name })),
    read: (spieler) => (spieler.selected === null ? [] : [spieler.selected.team_id]),
  };

  // Kader, Team, Position lead: the panel wraps three to a row, so the leading trio is always on screen.
  return [...SPIELER_FACETS.slice(0, 1), teamFacet, ...SPIELER_FACETS.slice(1)];
}
