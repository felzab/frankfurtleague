import type { FLBewerbung } from "./schemas";
import type { AdminBewerbungRow, NamedTeam } from "./types";

/**
 * The club an application is about: the proposed school's own name, or the picked club's.
 *
 * **One rule, one place**: the list renders it and the outbound message is addressed with it. `null`
 * where it names neither, the row `REQ-BEWERBUNG-002` refuses.
 */
export function bewerbungTeamName(bewerbung: Pick<FLBewerbung, "schule" | "team_id">, teams: readonly NamedTeam[]): string | null {
  if (bewerbung.schule !== null) return bewerbung.schule.team_name;
  if (bewerbung.team_id === null) return null;

  return teams.find((team) => team.id === bewerbung.team_id)?.name ?? null;
}

/**
 * The triage list, each application carrying the club it names and whether it stands in the SELECTED
 * season. Assembled here because a picked club is stored as an id, and a queue of ids is one nobody
 * can work down.
 */
export function buildBewerbungRows(
  bewerbungen: readonly FLBewerbung[],
  teams: readonly NamedTeam[],
  selectedSaisonId: string | undefined,
): AdminBewerbungRow[] {
  return bewerbungen.map((bewerbung) => ({
    ...bewerbung,
    teamName: bewerbungTeamName(bewerbung, teams),
    inSelectedSaison: bewerbung.saison_id === selectedSaisonId,
  }));
}

/**
 * What one acceptance did, a whole sentence per branch. Never a shared prefix with a spliced tail:
 * the two branches take different verbs, and only one of them composes.
 */
export function describeAufnahme({ createdTeam, gruppe, saisonId }: { createdTeam: boolean; gruppe: string; saisonId: string }): string {
  return createdTeam
    ? `Das Team wurde angelegt und in Gruppe ${gruppe} der Saison ${saisonId} aufgenommen.`
    : `Das Team wurde in Gruppe ${gruppe} der Saison ${saisonId} aufgenommen.`;
}
