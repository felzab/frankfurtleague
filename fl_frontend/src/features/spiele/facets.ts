import { PHASE_LABELS } from "@/features/saisons/constants";

import { computeSpielStatus } from "./utils";

import type { Facet, FacetOption } from "@/shared/utils/facets";
import type { FLSpiel } from "./schemas";

/** The five derived statuses, in the order a fixture passes through them. */
const STATUS_OPTIONS: readonly FacetOption[] = [
  { value: "ausstehend", label: "Ausstehend" },
  { value: "heute", label: "Heute" },
  { value: "vergangen", label: "Vergangen" },
  { value: "abgesagt", label: "Abgesagt" },
  { value: "unbekannt", label: "Ohne Datum" },
];

/** Distinct values of one embedded reference, in the order the fixtures name them. */
function distinct(spiele: readonly FLSpiel[], read: (spiel: FLSpiel) => { id: string; label: string } | null): FacetOption[] {
  const byId = new Map<string, string>();
  for (const spiel of spiele) {
    const found = read(spiel);
    if (found !== null && !byId.has(found.id)) byId.set(found.id, found.label);
  }
  return [...byId.entries()].map(([value, label]) => ({ value, label })).sort((left, right) => left.label.localeCompare(right.label, "de"));
}

/**
 * `today` is a parameter rather than read here: a second clock read would let the status facet and
 * the cards beside it disagree about what "heute" means.
 */
export function buildSpielFacets({
  spiele,
  today,
  isAdmin,
}: {
  spiele: readonly FLSpiel[];
  today: string;
  isAdmin: boolean;
}): Facet<FLSpiel>[] {
  const teamOptions = distinct(spiele, (spiel) => (spiel.team1 ? { id: spiel.team1.team_id, label: spiel.team1.name } : null)).concat(
    distinct(spiele, (spiel) => (spiel.team2 ? { id: spiel.team2.team_id, label: spiel.team2.name } : null)),
  );
  // Both sides feed one option list, so a club appears once whichever side it played on.
  const teams = [...new Map(teamOptions.map((option) => [option.value, option])).values()].sort((left, right) =>
    left.label.localeCompare(right.label, "de"),
  );

  // The order the filter surface draws its sections in; the admin branch below reorders it.
  const facets: Facet<FLSpiel>[] = [
    {
      param: "status",
      label: "Status",
      options: STATUS_OPTIONS,
      read: (spiel) => [computeSpielStatus({ datum: spiel.datum, isCanceled: spiel.is_canceled, today })],
    },
    {
      param: "phase",
      label: "Phase",
      options: (Object.keys(PHASE_LABELS) as (keyof typeof PHASE_LABELS)[]).map((phase) => ({ value: phase, label: PHASE_LABELS[phase] })),
      read: (spiel) => [spiel.saison_phase],
    },
    {
      param: "team",
      label: "Team",
      options: teams,
      // An unoccupied slot contributes nothing, which keeps an unresolved knockout fixture out of a
      // club's filtered list rather than wrongly in it.
      read: (spiel) => [spiel.team1?.team_id, spiel.team2?.team_id].filter((id): id is string => id !== undefined),
    },
    {
      param: "ort",
      label: "Ort",
      options: distinct(spiele, (spiel) => (spiel.ort ? { id: spiel.ort.spielort_id, label: spiel.ort.name } : null)),
      read: (spiel) => (spiel.ort === null ? [] : [spiel.ort.spielort_id]),
    },
  ];

  if (!isAdmin) return facets;

  const ergebnis: Facet<FLSpiel> = {
    param: "ergebnis",
    label: "Ergebnis",
    options: [
      { value: "gewertet", label: "Gewertet" },
      { value: "offen", label: "Noch offen" },
    ],
    // The rule `ergebnis_pending` and the rollover panel both use: a cancelled fixture WITH a
    // result is a forfeit and counts as played.
    read: (spiel) => [spiel.ergebnis === null ? "offen" : "gewertet"],
  };

  const ansetzung: Facet<FLSpiel> = {
    param: "ansetzung",
    label: "Ansetzung",
    // The negation leads, a narrow row clipping the tail. Not "Ohne" as the other facets use:
    // `status`'s "Ohne Datum" excludes cancelled fixtures and `kein_datum` does not.
    options: [
      { value: "kein_datum", label: "Kein Datum" },
      { value: "keine_uhrzeit", label: "Keine Uhrzeit" },
      { value: "kein_ort", label: "Kein Ort" },
      { value: "kein_schiedsrichter", label: "Kein Schiedsrichter" },
      { value: "vollstaendig", label: "Vollständig" },
    ],
    // Multi-value: a fixture missing three of the four matches three options. `vollstaendig` is the
    // absence of all four and so exclusive with them.
    read: (spiel) => {
      const missing: string[] = [];
      if (spiel.datum === null) missing.push("kein_datum");
      if (spiel.uhrzeit === null) missing.push("keine_uhrzeit");
      if (spiel.ort === null) missing.push("kein_ort");
      if (spiel.schiedsrichter === null) missing.push("kein_schiedsrichter");
      return missing.length === 0 ? ["vollstaendig"] : missing;
    },
  };

  const schiedsrichter: Facet<FLSpiel> = {
    param: "schiedsrichter",
    label: "Schiedsrichter",
    options: distinct(spiele, (spiel) =>
      spiel.schiedsrichter ? { id: spiel.schiedsrichter.schiedsrichter_id, label: spiel.schiedsrichter.name } : null,
    ),
    read: (spiel) => (spiel.schiedsrichter === null ? [] : [spiel.schiedsrichter.schiedsrichter_id]),
  };

  const [status, phase, team, ort] = facets;

  // `ansetzung` follows `status` because nothing else in the app finds an incomplete fixture. The
  // tail carries no ranking.
  return [status, ansetzung, team, phase, ort, ergebnis, schiedsrichter].filter((facet) => facet !== undefined);
}
