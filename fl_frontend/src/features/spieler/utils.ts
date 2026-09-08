import type { FLSpielerRolle, FLSpielerWithMemberships } from "./schemas";

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
   * place. `null` names no writer, and is right only where the caller's own row is retired.
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

  const protokoll =
    redactedAktionen === 0
      ? "Im Änderungsprotokoll stand nichts zu ihm."
      : redactedAktionen === 1
        ? "Ein Eintrag im Änderungsprotokoll wurde geleert."
        : `${String(redactedAktionen)} Einträge im Änderungsprotokoll wurden geleert.`;

  return `${kader} ${protokoll}`;
}
