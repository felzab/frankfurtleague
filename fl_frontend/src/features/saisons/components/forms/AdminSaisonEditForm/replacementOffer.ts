import { hasTakenPlace } from "@/features/saisons/utils";

import type { SaisonReplacementCandidate, SaisonReplacementContext, SaisonReplacementRow } from "@/features/saisons/types";
import type { FLSpiel } from "@/features/spiele/schemas";
import type { FLAustritt, FLGruppenNames } from "@/features/teams/schemas";

/** What the fixtures alone say about one club's place in the season. */
type SpieleOfRow = { spiele: number; gespielteSpiele: number; name: string; hasAustritt: boolean };

/**
 * Every club standing on the season's fixtures, with what they say about it. **The only route to a
 * junction row whose club is gone**: every club read starts at the `teams` collection, while a
 * fixture carries its side's stored name.
 */
function countSpieleProTeam(spiele: readonly FLSpiel[]): Map<string, SpieleOfRow> {
  const perTeam = new Map<string, SpieleOfRow>();

  for (const spiel of spiele) {
    const gespielt = hasTakenPlace(spiel);

    // Distinct sides, as `build_statistik_by_team` counts them: the endpoint reports per DOCUMENT,
    // and a fixture holding one club twice is a fault state rather than two games.
    const sides = new Map<string, NonNullable<FLSpiel["team1"]>>();
    for (const seite of [spiel.team1, spiel.team2]) if (seite !== null) sides.set(seite.team_id, seite);

    for (const [teamId, seite] of sides) {
      const held = perTeam.get(teamId) ?? { spiele: 0, gespielteSpiele: 0, name: seite.name, hasAustritt: seite.austritt_type !== null };
      held.spiele += 1;
      if (gespielt) held.gespielteSpiele += 1;
      perTeam.set(teamId, held);
    }
  }

  return perTeam;
}

/**
 * Both sides of the replacement offer. `gruppenphase` and `playoffs` together are every phase, which
 * is the set `REQ-REPLACE-002` judges and the set the rewrite moves — a narrower one would offer a
 * row the endpoint refuses.
 */
export function buildReplacementContext({
  saisonId,
  teams,
  ligaTeams,
  gruppenSpiele,
  playoffSpiele,
}: {
  saisonId: string;
  /** This season's clubs. A junction row whose club is gone is NOT among them — see below. */
  teams: readonly { id: string; name: string; gruppe: FLGruppenNames; austritt: FLAustritt | null }[];
  /** Every club of the league with the seasons it holds a row in, retired clubs included. */
  ligaTeams: readonly { id: string; name: string; inactive_since: string | null; memberships: readonly { saison_id: string }[] }[];
  gruppenSpiele: readonly FLSpiel[];
  playoffSpiele: readonly FLSpiel[];
}): SaisonReplacementContext {
  const perTeam = countSpieleProTeam([...gruppenSpiele, ...playoffSpiele]);

  const rows: SaisonReplacementRow[] = teams.map((team) => ({
    teamId: team.id,
    name: team.name,
    gruppe: team.gruppe,
    spiele: perTeam.get(team.id)?.spiele ?? 0,
    gespielteSpiele: perTeam.get(team.id)?.gespielteSpiele ?? 0,
    // From the club read rather than from a fixture: it holds the row itself, and a season without
    // a drawn Spielplan has no fixture to read one off.
    hasAustritt: team.austritt !== null,
    isVerwaist: false,
  }));

  // A club standing on a fixture that no club read lists holds a junction row nothing else here can
  // reach. It is offered from its fixtures alone, which is the state this operation repairs.
  const belegt = new Set(teams.map((team) => team.id));
  for (const [teamId, counted] of perTeam) {
    if (belegt.has(teamId)) continue;
    rows.push({
      teamId,
      name: counted.name,
      gruppe: null,
      spiele: counted.spiele,
      gespielteSpiele: counted.gespielteSpiele,
      hasAustritt: counted.hasAustritt,
      isVerwaist: true,
    });
  }

  const candidates: SaisonReplacementCandidate[] = ligaTeams.map((team) => ({
    id: team.id,
    name: team.name,
    isStillgelegt: team.inactive_since !== null,
    isInSaison: team.memberships.some((membership) => membership.saison_id === saisonId),
  }));

  // Sorted here because the appended rows arrive in fixture order; the candidates keep the order
  // their read sorted them into.
  return { rows: rows.sort((left, right) => left.name.localeCompare(right.name, "de")), candidates };
}

/**
 * How many of the season's fixtures change hands. Stated even at zero: a season drawn later hands
 * the arriving club every fixture that draw produces, and the sentence has to be true now.
 */
export function describeUebernommeneSpiele(spiele: number): string {
  if (spiele === 0) return "Angesetzte Spiele gibt es für diesen Platz noch keine.";
  if (spiele === 1) return "Das eine angesetzte Spiel wechselt mit, mit Gegner, Termin und Ort.";

  return `Alle ${String(spiele)} angesetzten Spiele wechseln mit, mit Gegner, Termin und Ort.`;
}

/** Where the row stands, for a sentence naming it. A row with no club document shows no group. */
export function describePlatz(gruppe: FLGruppenNames | null): string {
  return gruppe === null ? "in dieser Saison" : `in Gruppe ${gruppe}`;
}
