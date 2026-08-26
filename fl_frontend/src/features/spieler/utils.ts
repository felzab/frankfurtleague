import type { FLSpielerWithMemberships } from "./schemas";

/**
 * Mirrors `fl_backend/app/api/spieler/services.py :: normalised_nummer`, **leading zeros included**:
 * `"07"` is a shirt somebody had printed, not another way of writing `"7"`.
 */
export function normaliseSquadNummer(nummer: string | null | undefined): string | null {
  if (nummer === null || nummer === undefined) return null;

  return nummer.trim() || null;
}

/**
 * Whether this draft would put a second wearer on a shirt somebody in the same squad already has.
 *
 * Not a refusal — a shared number is permitted on every write path
 * (`fl_backend/app/core/domain.py :: UNENFORCED`); this only warns.
 */
export function isSquadNummerNewlyShared({
  draft,
  stored,
  takenInDraftTeam,
}: {
  /** Where this write would put the player, and in what shirt. */
  draft: { teamId: string | null; nummer: string | null };
  /** Where the row sits today; `null` when there is no squad row yet. */
  stored: { teamId: string; nummer: string | null } | null;
  /** Every OTHER live row's number in the DRAFT's team and season. */
  takenInDraftTeam: readonly (string | null)[];
}): boolean {
  const nummer = normaliseSquadNummer(draft.nummer);
  if (nummer === null) return false;
  // Only what the write INTRODUCES — the league fields four goalkeepers wearing 1. The PAIR counts:
  // moving an unchanged number into a team that has it is as new as typing it.
  if (stored !== null && stored.teamId === draft.teamId && normaliseSquadNummer(stored.nummer) === nummer) return false;

  return takenInDraftTeam.some((other) => normaliseSquadNummer(other) === nummer);
}

/**
 * Live squad numbers in one season, by team, excluding one player's own rows.
 *
 * **Retired rows are excluded** — a player who left mid-season is not still wearing the shirt.
 */
export function collectTakenSquadNummern({
  spieler,
  saisonId,
  exceptSpielerId,
}: {
  spieler: readonly FLSpielerWithMemberships[];
  saisonId: string;
  exceptSpielerId: string;
}): Record<string, string[]> {
  const byTeam: Record<string, string[]> = {};

  for (const person of spieler) {
    if (person.id === exceptSpielerId) continue;

    for (const membership of person.memberships) {
      if (membership.saison_id !== saisonId || membership.inactive_since !== null) continue;

      const nummer = normaliseSquadNummer(membership.nummer);
      if (nummer === null) continue;

      (byTeam[membership.team_id] ??= []).push(nummer);
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
