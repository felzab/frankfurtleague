import type { FLSpielerRolle, FLSpielerWithMemberships } from "./schemas";
import type { RowReturn, SpielerTeamOption } from "./types";

/**
 * Who holds each squad role in one season, by team, excluding one player's own rows.
 *
 * **Retired rows are excluded** — a player who left the squad is not leading it, which is the same
 * live-rows-only count the write path takes (`REQ-SQUAD-004`).
 */
export function collectHeldRollen({
  spieler,
  saisonId,
  exceptSpielerId,
}: {
  spieler: readonly FLSpielerWithMemberships[];
  saisonId: string;
  exceptSpielerId: string;
}): Record<string, Partial<Record<FLSpielerRolle, string>>> {
  const byTeam: Record<string, Partial<Record<FLSpielerRolle, string>>> = {};

  for (const person of spieler) {
    if (person.id === exceptSpielerId) continue;

    for (const membership of person.memberships) {
      if (membership.saison_id !== saisonId || membership.inactive_since !== null || membership.rolle === null) continue;

      // First writer wins. A squad holding one role twice is a state the write path refuses, so the
      // name shown is only ever a starting point for the person repairing it.
      (byTeam[membership.team_id] ??= {})[membership.rolle] ??=
        person.nachname === null ? person.vorname : `${person.vorname} ${person.nachname}`;
    }
  }

  return byTeam;
}

/**
 * Live rows per team in one season — the same count the write path takes
 * (`fl_backend/app/api/spieler/services.py :: build_live_squad_filter`), so a surface reading it
 * predicts `REQ-SQUAD-003` rather than approximating it. A retired row gave its place back.
 */
export function countLiveSquadRows({
  spieler,
  saisonId,
  exceptSpielerId,
}: {
  spieler: readonly FLSpielerWithMemberships[];
  saisonId: string;
  /**
   * The writing player, whose own row is not counted: a no-op edit must not be refused by its own
   * place. `null` names no writer, right where no row of the caller's could be counted: a create's,
   * or a retired one.
   */
  exceptSpielerId: string | null;
}): Record<string, number> {
  const byTeam: Record<string, number> = {};

  for (const person of spieler) {
    if (person.id === exceptSpielerId) continue;

    for (const membership of person.memberships) {
      // The PERSON's own retirement is deliberately not read: the write path's filter spans the
      // junction alone, so a person the league retired still holds the place their live row names.
      if (membership.saison_id !== saisonId || membership.inactive_since !== null) continue;

      byTeam[membership.team_id] = (byTeam[membership.team_id] ?? 0) + 1;
    }
  }

  return byTeam;
}

/**
 * Judged on the season's own junction rows, the one collection `REQ-SQUAD-001` counts, and in the
 * endpoint's order: a full squad is no fact worth reporting about a club the season does not hold.
 */
export function judgeRowReturn(teamId: string, saisonTeams: readonly SpielerTeamOption[]): RowReturn {
  const club = saisonTeams.find((team) => team.teamId === teamId);
  if (club === undefined) return "clubLeft";

  return club.isSquadFull === true ? "squadFull" : "open";
}

/**
 * A typed squad number as every write sends it, the squad editor's and the registration's alike: space
 * around it is no format anybody should fight, and an emptied box is a number nobody wears.
 */
export function nummerPayload(typed: string | null): string | null {
  const trimmed = (typed ?? "").trim();

  return trimmed === "" ? null : trimmed;
}

/**
 * An UNKNOWN cap refuses nothing: a squad the caller could not bound keeps its writes on offer
 * rather than losing them to a figure nothing there could read.
 */
export function squadIsFull(liveRows: number | undefined, maxKadergroesse: number | null): boolean {
  // `>=` and never `>`, the comparison the write path makes over the same count
  // (`fl_backend/app/api/spieler/services.py :: find_squad_capacity_refusal`).
  return maxKadergroesse !== null && (liveRows ?? 0) >= maxKadergroesse;
}

/**
 * What one erasure removed, in whole sentences: this lands in a toast beside no figures of its own.
 * Each half carries its own zero and its own singular, and the log is spelled as EMPTIED — no row is
 * dropped there, only the values a row held.
 */
export function describeErasureUmfang(erasedSaisonSpieler: number, redactedAktionen: number): string {
  // Zero is a sentence rather than a figure: German counts nothing with a word, and „0 Kadereinträge“
  // reads as a failed count.
  const kader =
    erasedSaisonSpieler === 0
      ? "Kadereinträge gab es keine."
      : erasedSaisonSpieler === 1
        ? "Ein Kadereintrag wurde gelöscht."
        : `${String(erasedSaisonSpieler)} Kadereinträge wurden gelöscht.`;

  // „dieser Person“ rather than a pronoun: the league fields players of both genders, and a gender map
  // beside the count would drift (`docs/frontend/spec.md` §1.12).
  const protokoll =
    redactedAktionen === 0
      ? "Im Änderungsprotokoll stand nichts zu dieser Person."
      : redactedAktionen === 1
        ? "Ein Eintrag im Änderungsprotokoll wurde geleert."
        : `${String(redactedAktionen)} Einträge im Änderungsprotokoll wurden geleert.`;

  return `${kader} ${protokoll}`;
}
