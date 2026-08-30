import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { buildEmptyKontaktperson } from "@/features/teams/utils";
import { buildRefusal } from "@/shared/utils/refusal";
import { mirrorTrainerSeat } from "@/shared/utils/trainerSeat";
import { toFieldErrors } from "@/shared/utils/validation";

import { FLPatchSaisonTeamKontaktePayloadSchema } from "./schemas";

import type { KontaktRolle } from "@/features/teams/constants";
import type { FLTeamMembership, FLTrainerZugleich } from "@/features/teams/schemas";
import type { KontaktpersonDraft, SaisonTeamKontakteDraft, TeamSaisonMembership } from "@/features/teams/types";
import type { FLKontaktErasureResponse } from "./schemas";
import type { SaisonTeamKontaktePayloadDraft } from "./types";

/** One count as German reads it, with a word for none and a word for one. */
function countPhrase(count: number, singular: string, plural: string): string {
  if (count === 0) return `keiner ${singular}`;
  if (count === 1) return `einer ${singular}`;

  return `${String(count)} ${plural}`;
}

/**
 * Counts and never the address: a report repeating the person hands back a copy of what was
 * destroyed. The applications are named even at zero, no admin surface listing them beside the
 * season's contacts.
 */
export function describeKontaktErasureUmfang(erasure: FLKontaktErasureResponse): string {
  // One sentence, because as two they contradict each other: „nichts gespeichert“ denies the person
  // the log still named. This is what an erasure meets after someone was swapped out of every seat.
  if (erasure.cleared_kontakt_slots === 0 && erasure.redacted_aktionen > 0) {
    const eintraege = erasure.redacted_aktionen === 1 ? "ein Eintrag" : `${String(erasure.redacted_aktionen)} Einträge`;

    return `Zu dieser E-Mail-Adresse war kein aktueller Kontakteintrag gespeichert, nur noch ${eintraege} im Änderungsprotokoll, und dort ist jetzt kein gesicherter Stand mehr hinterlegt.`;
  }

  const wo = `${countPhrase(erasure.cleared_saison_teams, "Saison-Zugehörigkeit", "Saison-Zugehörigkeiten")} und ${countPhrase(
    erasure.cleared_bewerbungen,
    "Bewerbung",
    "Bewerbungen",
  )}`;

  // Zero is a sentence rather than a figure: German counts nothing with a word, and „0 Kontakteinträge“
  // reads as a failed count. Past the branch above, no slot cleared means nothing matched anywhere.
  const kontakte =
    erasure.cleared_kontakt_slots === 0
      ? "Zu dieser E-Mail-Adresse war nichts gespeichert."
      : erasure.cleared_kontakt_slots === 1
        ? `Ein Kontakteintrag wurde geleert, in ${wo}.`
        : `${String(erasure.cleared_kontakt_slots)} Kontakteinträge wurden geleert, in ${wo}.`;

  // Never „geleert“: `build_redaction_filter` is not narrowed to rows holding an image, so a row
  // recording an insert is stamped while losing nothing. What holds for both is that no saved state
  // is left on it.
  const protokoll =
    erasure.redacted_aktionen === 0
      ? "Im Änderungsprotokoll gab es dazu keinen Eintrag."
      : erasure.redacted_aktionen === 1
        ? "Bei einem Eintrag im Änderungsprotokoll ist kein gesicherter Stand mehr hinterlegt."
        : `Bei ${String(erasure.redacted_aktionen)} Einträgen im Änderungsprotokoll ist kein gesicherter Stand mehr hinterlegt.`;

  return `${kontakte} ${protokoll}`;
}

/**
 * The Trainer seat, filled from the seat that declared itself the coach.
 *
 * **Composed at save time and never written into the draft.** Written in, it overwrote whichever of
 * the two real people the claim did not name, on the first keystroke and with no undo — a stored row
 * can hold the claim over two DIFFERENT people, which the backend never checks.
 */
export function mirrorKontakte(draft: SaisonTeamKontakteDraft): SaisonTeamKontakteDraft {
  return mirrorTrainerSeat(draft);
}

/**
 * One seat's switch: the block it leaves, and whether the seats are re-judged. Re-judged on the way
 * to EMPTY only — a seat just switched on holds fields nobody has typed in, and a message over one of
 * those describes a value nobody finished.
 */
export function applySeatPresence(
  value: SaisonTeamKontakteDraft,
  rolle: KontaktRolle,
  present: boolean,
  /** What the seat held when it was switched off. Absent for a seat that has never held anybody. */
  zurueck?: KontaktpersonDraft,
): { next: SaisonTeamKontakteDraft; revalidate: boolean } {
  // Given BACK rather than rebuilt: a switch is not a delete, and an admin who turns a seat off and
  // on again has not asked for the details they entered to be thrown away.
  const seat = present ? (zurueck ?? buildEmptyKontaktperson()) : null;

  return { next: { ...value, [rolle]: seat }, revalidate: !present };
}

/**
 * The shared-seat pick: the block it leaves, and whether the seats are re-judged. The seats never
 * move — the claim is composed at save — so what changes is WHO the Trainer reads, and no blur on its
 * read-only boxes clears the verdict left behind.
 */
export function applySharedSeat(
  value: SaisonTeamKontakteDraft,
  seat: FLTrainerZugleich | null,
): { next: SaisonTeamKontakteDraft; revalidate: boolean } {
  const next = { ...value, trainer_ist_zugleich: seat };

  // The seats never move here — the claim is honoured when the payload is composed. What changes is
  // WHO the Trainer reads, so a verdict standing at a trainer path judged a different person.
  return { next: next, revalidate: seat !== value.trainer_ist_zugleich };
}

/**
 * The paths one judgement covers. While the claim stands the composed Trainer READS the named seat,
 * so judging that seat alone leaves the Trainer's verdict over a value it no longer holds.
 */
export function mirroredJudgedPaths(paths: readonly string[], mirroredSeat: FLTrainerZugleich | null): readonly string[] {
  if (mirroredSeat === null) return paths;

  const copies = paths
    .filter((path) => path.startsWith(`kontakte.${mirroredSeat}.`))
    .map((path) => path.replace(`kontakte.${mirroredSeat}.`, "kontakte.trainer."));

  return copies.length === 0 ? paths : [...paths, ...copies];
}

/**
 * The seats that HELD somebody and hold nobody in the draft, in the panel's own order. Both halves
 * are needed: a seat empty in the stored row too is not a removal, and warning about one would raise
 * the confirmation over a form nobody has touched.
 */
export function emptiedSeatLabels(stored: SaisonTeamKontakteDraft | null, draft: SaisonTeamKontakteDraft | null): readonly string[] {
  return KONTAKT_ROLLEN.filter(({ value }) => stored?.[value] != null && (draft?.[value] ?? null) === null).map(({ label }) => label);
}

/** The club's own page, where the season membership these seats hang off is entered. */
export function teamPageHref(teamId: string, saisonId: string): string {
  // The season rides along: the seats are season-scoped, and a link without it lands the admin on
  // whichever season that page falls back to.
  return `/admin/teams/${teamId}?saison_id=${encodeURIComponent(saisonId)}`;
}

/**
 * The selected season's junction row for one club, or `null` where the club does not play it. Never
 * another season's row: the header names the selected one and a save writes onto it, so a fallback
 * would move three people between seasons.
 */
export function resolveTeamSaisonMembership(
  memberships: readonly FLTeamMembership[],
  saison: { id: string; status: TeamSaisonMembership["saisonStatus"] },
): TeamSaisonMembership {
  const membership = memberships.find((candidate) => candidate.saison_id === saison.id) ?? null;

  return {
    saisonId: saison.id,
    saisonStatus: saison.status,
    membership:
      membership === null
        ? null
        : {
            gruppe: membership.gruppe,
            austritt: membership.austritt,
            trikot_farbe: membership.trikot_farbe,
            kontakte: membership.kontakte,
          },
  };
}

/**
 * Why the pre-save block cannot go back through the write, or `null` where it can. Backend I36
 * (`docs/backend/spec.md`) admits a malformed address on READ so a bad row stays repairable; that
 * same row is no legal write, and no reload makes it one.
 */
export function describeUnrestorableKontakte(payload: SaisonTeamKontaktePayloadDraft): string | null {
  const parsed = FLPatchSaisonTeamKontaktePayloadSchema.safeParse(payload);
  if (parsed.success) return null;

  const refused = Object.keys(toFieldErrors(parsed.error));
  const seats = KONTAKT_ROLLEN.filter(({ value }) => refused.some((path) => path.startsWith(`kontakte.${value}`))).map(({ label }) => label);
  // The seats are named where any can be: the admin has to know which of the three to re-enter, and
  // the values themselves are the person's, so no field of them is echoed here.
  const wo = seats.length === 0 ? "" : ` (${seats.join(", ")})`;

  return buildRefusal({
    reason: `Der Stand vor dem Speichern hält ungültige Angaben${wo} und lässt sich nicht zurückschreiben`,
    repair: "Trage ihn bei Bedarf von Hand ein",
  });
}
