/**
 * SPIELE · what the Spielsuche can be narrowed by
 *
 * Roadmap item FE-5, folded into the filter work because it is the same control (owner, 2026-08-07).
 *
 *  INVARIANTS ───────────────────────────────────────────────────────────────────────────────────────────
 *
 *   • **The options for Team, Ort and Schiedsrichter are DERIVED from the matches in hand**, not fetched.
 *     The view already holds the season's fixtures, so every club that plays, every venue that hosts and
 *     every referee assigned is in them — and a facet built that way can never offer a value that would
 *     narrow to nothing.
 *   • **The admin set is larger, and the difference is completeness rather than access.** Ergebnis,
 *     Ansetzung and Schiedsrichter answer "what still needs entering", which is an admin's question about
 *     their own data; the public set is the four facets a visitor would recognise as ways to find a match.
 *   • `status` is DERIVED and not stored, so it reads through `computeSpielStatus` — the same function the
 *     cards label themselves with, so a chip reading „HEUTE“ and the facet that finds it cannot disagree.
 *     The backend's own `spiel_status` filter defines `ausstehend` more widely on purpose (ADR-0072); this
 *     filters on the client, so the label's definition is the one that applies and the one on screen.
 *   • Every facet is built inside one `useMemo` per surface, keyed on the fixture list, because
 *     `AdminCrudView`'s collection-identity constraint applies to the Spielsuche's own Fuse memo too.
 */

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
 * Every facet the Spielsuche offers, for the surface it is on.
 *
 * `today` is a parameter rather than read here, because the view already has it and a second clock read
 * would let the status facet and the cards beside it disagree about what "heute" means.
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
      // Both sides, so picking one club finds every fixture it appears in. A slot with no occupant
      // contributes nothing, which is what makes an unresolved knockout fixture absent from a club's
      // filtered list rather than wrongly present in it.
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

  return [
    ...facets,
    {
      param: "ergebnis",
      label: "Ergebnis",
      options: [
        { value: "gewertet", label: "Gewertet" },
        { value: "offen", label: "Noch offen" },
      ],
      // `ergebnis === null` is the same rule the action-required list's `ergebnis_pending` uses and the
      // same one the rollover panel counts: a cancelled fixture WITH a result is a forfeit and counts as
      // played (ADR-0026).
      read: (spiel) => [spiel.ergebnis === null ? "offen" : "gewertet"],
    },
    {
      param: "ansetzung",
      label: "Ansetzung",
      options: [
        { value: "kein_datum", label: "Datum fehlt" },
        { value: "keine_uhrzeit", label: "Uhrzeit fehlt" },
        { value: "kein_ort", label: "Ort fehlt" },
        { value: "kein_schiedsrichter", label: "Schiedsrichter fehlt" },
        { value: "vollstaendig", label: "Vollständig" },
      ],
      // Multi-value on purpose: a fixture missing three of the four matches three options, so picking any
      // one of them finds it. `vollstaendig` is the absence of all four and therefore exclusive with them.
      read: (spiel) => {
        const missing: string[] = [];
        if (spiel.datum === null) missing.push("kein_datum");
        if (spiel.uhrzeit === null) missing.push("keine_uhrzeit");
        if (spiel.ort === null) missing.push("kein_ort");
        if (spiel.schiedsrichter === null) missing.push("kein_schiedsrichter");
        return missing.length === 0 ? ["vollstaendig"] : missing;
      },
    },
    {
      param: "schiedsrichter",
      label: "Schiedsrichter",
      options: distinct(spiele, (spiel) =>
        spiel.schiedsrichter ? { id: spiel.schiedsrichter.schiedsrichter_id, label: spiel.schiedsrichter.name } : null,
      ),
      read: (spiel) => (spiel.schiedsrichter === null ? [] : [spiel.schiedsrichter.schiedsrichter_id]),
    },
  ];
}
