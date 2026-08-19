/**
 * SPIELER · pure derivations
 *
 * No fetching and no framework, so the squad-number derivation below is testable without a request.
 *
 * **Nothing here is a refusal.** A shared shirt number is a permitted state on every write path
 * (`fl_backend/app/core/domain.py :: UNENFORCED`), so what this module answers is whether the draft
 * would introduce one — a fact the editor raises as a warning and saves through.
 */

import type { FLSpielerWithMemberships } from "./schemas";

/**
 * A squad number as any comparison of two reads them, or `null` where there is nothing to compare.
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
 * Whether this draft would put a second wearer on a shirt somebody in the same squad already has.
 *
 * **It answers for a state the write INTRODUCES**, never for one already stored. The league fields
 * four goalkeepers wearing 1, so a row that is where it was, wearing what it wore, raises nothing —
 * otherwise every edit to those rows would carry a warning about a fact the admin cannot change from
 * this page and did not cause. A row with no number is never shared either: several players may have
 * no shirt assigned yet, and that is the ordinary state of a squad being filled in.
 *
 * **The placement is the pair, not the number.** Moving an unchanged number into a team that already
 * has it is as new as typing it, which is why the stored comparison is on `teamId` and `nummer`
 * together.
 */
export function isSquadNummerNewlyShared({
  draft,
  stored,
  takenInDraftTeam,
}: {
  /** Where this write would put the player, and in what shirt. */
  draft: { teamId: string | null; nummer: string | null };
  /** Where the row sits today, or `null` where there is no squad row yet. */
  stored: { teamId: string; nummer: string | null } | null;
  /** Every OTHER live row's number in the DRAFT's team and season. */
  takenInDraftTeam: readonly (string | null)[];
}): boolean {
  const nummer = normaliseSquadNummer(draft.nummer);
  if (nummer === null) return false;
  if (stored !== null && stored.teamId === draft.teamId && normaliseSquadNummer(stored.nummer) === nummer) return false;

  return takenInDraftTeam.some((other) => normaliseSquadNummer(other) === nummer);
}

/**
 * Every live squad number in use in one season, by team, excluding one player's own rows.
 *
 * **Retired rows are excluded**: a player who left a team mid-season is not still wearing the shirt, and a
 * squad row really does retire — unlike a team's junction, which never leaves a season.
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
