import { PHASE_LABELS } from "@/features/saisons/constants";
import { bookedSchiedsrichterName } from "@/features/schiedsrichter/constants";

import { SONDEREREIGNIS_LABELS, SONDEREREIGNIS_OPTIONS } from "./constants";
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

/** No entry for an ordinary fixture: `null` is the absence of an event, not a sixth one to filter on. */
const SONDEREREIGNIS_FACET_OPTIONS: readonly FacetOption[] = SONDEREREIGNIS_OPTIONS.map((event) => ({
  value: event,
  label: SONDEREREIGNIS_LABELS[event],
}));

/**
 * Keyed on the id a fixture embeds: the erasure repoints every erased referee's fixtures at the one
 * ghost, so they already arrive under a single id and need no option merged by hand.
 */
function schiedsrichterOptionValue(schiedsrichter: NonNullable<FLSpiel["schiedsrichter"]>): string {
  return schiedsrichter.schiedsrichter_id;
}

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
  spieltage = [],
  teams = [],
  spielorte = [],
  schiedsrichter = [],
}: {
  spiele: readonly FLSpiel[];
  today: string;
  isAdmin: boolean;
  /**
   * The season's matchdays in the order they are played, each already carrying the label
   * `fl_frontend/src/features/spieltage/utils.ts :: spieltagLabels` composes. Empty leaves the facet
   * off altogether, rather than offering a dimension with nothing in it.
   */
  spieltage?: readonly { id: string; label: string }[];
  /**
   * Every club, venue and referee the page may read, fixtures or none. They label a value a link from
   * another list names and no fixture here holds, which the options alone would drop without a word.
   */
  teams?: readonly { id: string; name: string }[];
  spielorte?: readonly { id: string; name: string }[];
  schiedsrichter?: readonly { id: string; name: string | null }[];
}): Facet<FLSpiel>[] {
  const teamOptions = distinct(spiele, (spiel) => (spiel.team1 ? { id: spiel.team1.team_id, label: spiel.team1.name } : null)).concat(
    distinct(spiele, (spiel) => (spiel.team2 ? { id: spiel.team2.team_id, label: spiel.team2.name } : null)),
  );
  // Both sides feed one option list, so a club appears once whichever side it played on.
  const teamOptionsInSaison = [...new Map(teamOptions.map((option) => [option.value, option])).values()].sort((left, right) =>
    left.label.localeCompare(right.label, "de"),
  );

  const status: Facet<FLSpiel> = {
    param: "status",
    label: "Status",
    options: STATUS_OPTIONS,
    read: (spiel) => [computeSpielStatus({ datum: spiel.datum, sonderereignis: spiel.sonderereignis, today })],
  };

  const phase: Facet<FLSpiel> = {
    param: "phase",
    label: "Phase",
    options: (Object.keys(PHASE_LABELS) as (keyof typeof PHASE_LABELS)[]).map((phase) => ({ value: phase, label: PHASE_LABELS[phase] })),
    read: (spiel) => [spiel.saison_phase],
  };

  const team: Facet<FLSpiel> = {
    param: "team",
    label: "Team",
    options: teamOptionsInSaison,
    known: teams.map((team) => ({ value: team.id, label: team.name })),
    // An unoccupied slot contributes nothing, which keeps an unresolved knockout fixture out of a
    // club's filtered list rather than wrongly in it.
    read: (spiel) => [spiel.team1?.team_id, spiel.team2?.team_id].filter((id): id is string => id !== undefined),
  };

  const ort: Facet<FLSpiel> = {
    param: "ort",
    label: "Ort",
    options: distinct(spiele, (spiel) => (spiel.ort ? { id: spiel.ort.spielort_id, label: spiel.ort.name } : null)),
    known: spielorte.map((spielort) => ({ value: spielort.id, label: spielort.name })),
    read: (spiel) => (spiel.ort === null ? [] : [spiel.ort.spielort_id]),
  };

  // The only facet whose options cannot come off the fixtures: a matchday's German name is composed
  // rather than served, so the page that fetched the matchdays hands it in.
  const spieltag: Facet<FLSpiel> | undefined =
    spieltage.length === 0
      ? undefined
      : {
          param: "spieltag",
          label: "Spieltag",
          // Left in the order it arrived, which is the order the matchdays are played. `distinct`'s
          // alphabetical sort would answer „10. Spieltag“ before „2. Spieltag“.
          options: spieltage.map((entry) => ({ value: entry.id, label: entry.label })),
          // Unconditional where `ort` and `schiedsrichter` guard a null: every fixture belongs to a
          // matchday, so there is no absent case for this one to fold away.
          read: (spiel) => [spiel.spieltag_id],
        };

  // The order the filter surface draws its sections in; the admin branch below reorders it. `spieltag`
  // follows `phase`, the two narrowing the same axis a round apart.
  if (!isAdmin) return [status, phase, spieltag, team, ort].filter((facet) => facet !== undefined);

  const ergebnis: Facet<FLSpiel> = {
    param: "ergebnis",
    label: "Ergebnis",
    options: [
      { value: "gewertet", label: "Gewertet" },
      { value: "offen", label: "Offen" },
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

  // Admin-only: it names the stored vocabulary rather than the chip a visitor reads. Without it
  // nothing finds an abandoned fixture, `status` letting `abgebrochen` through by date.
  const sonderereignis: Facet<FLSpiel> = {
    param: "sonderereignis",
    label: "Sonderereignis",
    options: SONDEREREIGNIS_FACET_OPTIONS,
    read: (spiel) => (spiel.sonderereignis === null ? [] : [spiel.sonderereignis]),
  };

  const schiedsrichterFacet: Facet<FLSpiel> = {
    param: "schiedsrichter",
    label: "Schiedsrichter",
    options: distinct(spiele, (spiel) =>
      spiel.schiedsrichter
        ? { id: schiedsrichterOptionValue(spiel.schiedsrichter), label: bookedSchiedsrichterName(spiel.schiedsrichter) }
        : null,
    ),
    // Keyed as a fixture's referee is, so a link built from a row reaches the option its fixtures sit
    // under. The ghost reaches this list through no season's referees, only through their fixtures.
    known: schiedsrichter.map((row) => ({ value: row.id, label: bookedSchiedsrichterName({ schiedsrichter_id: row.id, name: row.name }) })),
    read: (spiel) => (spiel.schiedsrichter === null ? [] : [schiedsrichterOptionValue(spiel.schiedsrichter)]),
  };

  // `ansetzung` follows `status` because it is the only facet that narrows these rows to an
  // incomplete fixture; the season-wide queue at
  // `fl_frontend/src/app/admin/(current-saison)/action_required/page.tsx` is where one is found off this list. The
  // tail carries no ranking.
  return [status, ansetzung, team, phase, spieltag, ort, ergebnis, sonderereignis, schiedsrichterFacet].filter((facet) => facet !== undefined);
}
