import { asSignInIdentifier } from "@/core/emailAddress";
import { EINWILLIGUNG_UMFANG, KONTAKT_ROLLEN } from "@/features/teams/constants";
import { buildEmptyKontaktperson } from "@/features/teams/utils";
import { mirrorTrainerSeat } from "@/shared/utils/trainerSeat";

import type {
  FLAustritt,
  FLKontaktpersonPayload,
  FLKontaktZeile,
  FLSaisonTeamKontaktePayload,
  FLTeamMembership,
  FLTeamWithMemberships,
  FLTrainerZugleich,
} from "@/core/generated/client/types";
import type { KontaktRolle } from "@/features/teams/constants";
import type { KontaktpersonDraft, SaisonTeamKontakteDraft, TeamSaisonMembership } from "@/features/teams/types";

/**
 * The block with every seat naming `textVersion`, the form's running label: a handed seat is a new
 * acceptance only that label may stamp, and a kept seat's stored record stands whatever is sent.
 */
export function mitLaufenderFassung(kontakte: FLSaisonTeamKontaktePayload, textVersion: string): FLSaisonTeamKontaktePayload {
  const gestempelt = (sitz: FLKontaktpersonPayload | null) =>
    sitz === null ? null : { ...sitz, einwilligung: { ...sitz.einwilligung, text_version: textVersion } };

  return {
    ...kontakte,
    trainer: gestempelt(kontakte.trainer),
    ansprechperson: gestempelt(kontakte.ansprechperson),
    stellvertretung: gestempelt(kontakte.stellvertretung),
  };
}

/**
 * The Trainer seat, filled from the seat that declared itself the coach. **Composed at save time,
 * never written into the draft**: a stored row can hold the claim over two DIFFERENT people, and
 * writing it in overwrites the other, with no undo.
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
  /** The label the application form runs, which a seat opened blank stamps; `null` where it could not be read. */
  textVersion: string | null,
  /** What the seat held when it was switched off. Absent for a seat that has never held anybody. */
  zurueck?: KontaktpersonDraft,
): { next: SaisonTeamKontakteDraft; revalidate: boolean } {
  // Given BACK rather than rebuilt: a switch is not a delete, and turning a seat off and on again asks
  // for nothing typed to be thrown away. Without a label a blank seat has no wording to stamp.
  const blank = textVersion === null ? null : buildEmptyKontaktperson(textVersion);
  const seat = present ? (zurueck ?? blank) : null;

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

/** Who holds a seat, by the three fields `fl_backend/app/api/teams/services.py :: SEAT_IDENTITY_FIELDS` names. */
function seatIdentity(seat: KontaktpersonDraft): readonly string[] {
  // The server's two folds, so the banner warns over exactly the stamps the save drops: the address as
  // sign-in folds it, and a name composed and lower-cased, „Weiß“ staying apart from „Weiss“.
  const name = (wert: string): string => wert.normalize("NFC").trim().split(/\s+/).join(" ").toLowerCase();

  return [asSignInIdentifier(seat.email), name(seat.vorname), name(seat.nachname)];
}

/** The seats whose person confirmed and whose draft names somebody else, in the panel's own order. */
export function renamedConfirmedSeatLabels(stored: SaisonTeamKontakteDraft | null, draft: SaisonTeamKontakteDraft | null): readonly string[] {
  return KONTAKT_ROLLEN.filter(({ value }) => {
    const held = stored?.[value] ?? null;
    const sent = draft?.[value] ?? null;
    // Both halves: a seat nobody confirmed has no stamp for the save to take, and an unchanged one would
    // raise the confirmation over a form nobody has touched.
    if (held === null || sent === null || held.einwilligung.bestaetigt_am === null) return false;

    // Field by field, never one joined run: „Anna Maria“ moved from the forename into the surname folds
    // to the same words, and the server compares the three apart.
    const gehalten = seatIdentity(held);
    const getippt = seatIdentity(sent);

    return gehalten.some((wert, index) => wert !== getippt[index]);
  }).map(({ label }) => label);
}

/**
 * The confirmed seats whose draft keeps the person's name and changes the address alone: a person who only changed
 * mailbox keeps their seat and its confirmation through the address change, which this save would cost them.
 */
export function addressOnlyConfirmedSeatLabels(
  stored: SaisonTeamKontakteDraft | null,
  draft: SaisonTeamKontakteDraft | null,
): readonly string[] {
  return KONTAKT_ROLLEN.filter(({ value }) => {
    const held = stored?.[value] ?? null;
    const sent = draft?.[value] ?? null;
    if (held === null || sent === null || held.einwilligung.bestaetigt_am === null) return false;

    const [heldAddress, ...heldName] = seatIdentity(held);
    const [sentAddress, ...sentName] = seatIdentity(sent);

    return heldAddress !== sentAddress && heldName.every((wert, index) => wert === sentName[index]);
  }).map(({ label }) => label);
}

/** The club's own page, where the season membership these seats hang off is entered. */
export function teamPageHref(teamId: string, saisonId: string): string {
  // The season rides along: the seats are season-scoped, and a link without it lands the admin on
  // whichever season that page falls back to.
  return `/bereich/admin/teams/${teamId}?saison_id=${encodeURIComponent(saisonId)}`;
}

/**
 * The state that fixes what a link minted on the row opens: once its season is over or its team has
 * left it, the backend mints a newcomer a link taking the Widerspruch alone and sends no fresh one
 * (`REQ-KONTAKT-005`).
 */
export function kontaktZeile(saisonStatus: TeamSaisonMembership["saisonStatus"], austritt: FLAustritt | null): FLKontaktZeile {
  if (saisonStatus === "past") return "saison_vorbei";

  return austritt === null ? "offen" : "ausgetreten";
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
            bestaetigungen: membership.bestaetigungen,
            adresswechsel: membership.adresswechsel,
            kontakte_stand: membership.kontakte_stand,
          },
  };
}

/**
 * The contacts editor's key, holding neither the club's other rows nor a seat's link state or pending address change:
 * those move with no edit here, and remounting on them drops the typed draft.
 */
export function kontakteEditorKey(
  { id, name, shorthand, inactive_since }: FLTeamWithMemberships,
  { membership, ...saison }: TeamSaisonMembership,
): string {
  const team = { id, name, shorthand, inactive_since };
  if (membership === null) return JSON.stringify({ team, saison, membership });
  const { bestaetigungen: _bestaetigungen, adresswechsel: _adresswechsel, ...gesaet } = membership;

  return JSON.stringify({ team, saison, membership: gesaet });
}

/** One seat as the write side spells it: the provenance is the server's own. */
const kontaktpersonPayload = (person: KontaktpersonDraft | null): FLKontaktpersonPayload | null =>
  person === null
    ? null
    : {
        vorname: person.vorname,
        nachname: person.nachname,
        email: person.email,
        telefon: person.telefon,
        // No `geburtsdatum`: the date is the person's own to enter at their confirmation, so the
        // server carries the stored seat's forward and this editor may not name one at all.
        einwilligung: {
          umfang: EINWILLIGUNG_UMFANG,
          text_version: person.einwilligung.text_version,
          datum: person.einwilligung.datum,
        },
      };

/**
 * The stored block as the endpoint's own payload. The narrow scope is deliberate: the backend
 * restores a confirmed seat's wider consent from the confirmation,
 * so a save must never name it.
 */
export function toKontaktePayload(kontakte: SaisonTeamKontakteDraft | null): FLSaisonTeamKontaktePayload | null {
  if (kontakte === null) return null;

  return {
    trainer: kontaktpersonPayload(kontakte.trainer),
    ansprechperson: kontaktpersonPayload(kontakte.ansprechperson),
    stellvertretung: kontaktpersonPayload(kontakte.stellvertretung),
    trainer_ist_zugleich: kontakte.trainer_ist_zugleich,
  };
}
