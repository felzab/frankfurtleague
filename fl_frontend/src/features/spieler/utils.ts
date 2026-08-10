/**
 * SPIELER · pure derivations
 *
 * No fetching and no framework, so the squad-number rule below is testable without a request. It mirrors
 * `fl_backend/app/api/spieler/services.py :: find_squad_refusal`, which stays the authoritative check.
 */

import type { FLSpielerWithMemberships } from "./schemas";

/**
 * A squad number as the uniqueness rule compares it, or `null` where there is nothing to compare.
 *
 * Mirrors `fl_backend/app/api/spieler/services.py :: normalised_nummer` exactly, including what it does
 * NOT do: `nummer` is free text because a number is worn rather than counted, so `"7"` and `" 7 "` are one
 * number and an empty string is no number at all — but **leading zeros are kept**. `"07"` is a shirt
 * somebody had printed, and deciding it is the same shirt as `"7"` is a judgement this rule does not make.
 */
export function normaliseSquadNummer(nummer: string | null | undefined): string | null {
  if (nummer === null || nummer === undefined) return null;

  return nummer.trim() || null;
}

/**
 * Whether this number would be taken from somebody else in the same squad — the browser's half of
 * `REQ-SQUAD-002`.
 *
 * **It fires only on a number the write INTRODUCES**, which is the part that is easy to get wrong.
 * Resubmitting the stored value passes even where it already duplicates, and that is deliberate on both
 * sides: it is what keeps a row with an existing clash editable at all, including by the edit that would
 * resolve it. A row with no number is never a collision either — several players may have no shirt
 * assigned yet, and that is the ordinary state of a squad being filled in.
 */
export function isSquadNummerTaken({
  proposed,
  stored,
  taken,
}: {
  proposed: string | null;
  /** What this row holds today; `null` on a create. */
  stored: string | null;
  /** Every OTHER live row's number in the same team and season. */
  taken: readonly (string | null)[];
}): boolean {
  const normalised = normaliseSquadNummer(proposed);
  if (normalised === null || normalised === normaliseSquadNummer(stored)) return false;

  return taken.some((other) => normaliseSquadNummer(other) === normalised);
}

/**
 * Every live squad number in use in one season, by team, excluding one player's own rows.
 *
 * **Retired rows are excluded**, matching the endpoint's `inactive_since: None` filter: a player who left
 * a team mid-season is not still wearing the shirt, and a squad row really does retire — unlike a team's
 * junction, which never leaves a season (ADR-0026).
 *
 * Built from `GET /spieler/memberships`, which the squad editor already reads for the player it is
 * editing, so the check costs no request of its own.
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
