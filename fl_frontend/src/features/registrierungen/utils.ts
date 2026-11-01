import { KONTAKT_EMAIL } from "@/core/brand";
import { isRecordMissing } from "@/core/errors";
import { medienNochNicht } from "@/features/bewerbungen/utils";
import { nummerPayload } from "@/features/spieler/utils";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";
import { ANTWORT_NEU_OEFFNEN, FASSUNG_NEU_OEFFNEN, REGISTRIERUNG_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { alterAusserhalb } from "./constants";

import type {
  FLInvitationViewResponse,
  FLPostRegistrierungPayload,
  FLRegistrierung,
  FLRegistrierungConfirmationPayload,
} from "@/core/generated/client/types";
import type { NamedTeam } from "@/features/bewerbungen/types";
import type { FieldErrors } from "@/shared/utils/validation";
import type { AdminRegistrierungRow, RegistrierungFormDraft, SpielerLinkZustand } from "./types";

/**
 * Which state the invite puts the registration page in.
 *
 * A link pasted after the window closed has to read „geschlossen“, or its holder goes away
 * believing an administrator revoked it. `laeuft` is the server's whole judgement.
 */
export function einladungZustand(ansicht: FLInvitationViewResponse): "valid" | "closed" {
  return ansicht.running ? "valid" : "closed";
}

/**
 * Which verdict of the read closes the form, in the order a reader can act on.
 *
 * A shut window outranks the rest; a missing team is the team's own to repair; a full squad reopens
 * when a place falls free.
 */
export function formularZustand(ansicht: FLInvitationViewResponse): "valid" | "closed" | "team-fehlt" | "kader-voll" {
  if (!ansicht.running) return "closed";
  if (!ansicht.team_entered) return "team-fehlt";

  return ansicht.kader_free ? "valid" : "kader-voll";
}

/**
 * The draft as the submission spells it.
 *
 * Every optional field is nulled here rather than per keystroke: `""` is a box nobody filled in, and
 * normalising as it is typed would eat a digit the moment it was deleted.
 */
export function registrierungPayload(draft: RegistrierungFormDraft, token: string): FLPostRegistrierungPayload {
  return {
    token: token,
    vorname: draft.vorname,
    nachname: draft.nachname,
    email: draft.email,
    position: draft.position,
    nummer: nummerPayload(draft.nummer),
    stufe: draft.stufe,
  };
}

/**
 * A submission refusal as what the form should show, or `null` where the code is none of these.
 *
 * A refusal naming a field takes that field's own path, so it lands under the control at fault.
 */
export function mapRegistrierungSubmitRefusal(
  error: unknown,
): { error?: string; fieldErrors?: FieldErrors; unplacedError?: string; zustand?: "invalid"; schonAngekommen?: true } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // Every body rule the form can break is mirrored, so a refusal no box can take is of a drifted
    // client, which the team's link replaces.
    case "body_unreadable":
    case "payload_refused":
      return refusedPayloadAnswer(error, REGISTRIERUNG_NEU_OEFFNEN);
    // The link died between the page loading and this press, or the season or the club it names is
    // gone: the whole page is the answer, since a banner over a form nothing accepts invites a second attempt.
    case "document_not_found":
      return { zustand: "invalid" };
    // Each reachable only where the season moved after this page loaded, and the team's link reopens
    // onto a page read since: the window's or the team's own panel, or the Stufen offered now.
    case "registrierung_closed":
    case "registrierung_stufe_not_allowed":
      return { error: REGISTRIERUNG_NEU_OEFFNEN };
    case "registrierung_kader_full":
      return {
        error: buildRefusal({
          reason: "Der Kader dieses Teams ist voll",
          repair: "Wende Dich an Dein Team, wenn Du trotzdem mitspielen sollst",
        }),
      };
    // The press this form repeated stands, under the details first sent: a banner rather than a
    // field, since whichever box changed since then is not the one at fault.
    case "registrierung_key_differing":
      return {
        schonAngekommen: true,
        error: buildRefusal({
          reason: "Deine Registrierung ist schon angekommen, mit den Angaben, die Du zuerst abgeschickt hast",
          repair: `Soll sich daran etwas ändern, schreib uns an ${KONTAKT_EMAIL}`,
        }),
      };
    // The same press, replayed after the team admitted it: the key outlives the registration on the
    // squad row, so the answer is the admission rather than a second registration.
    case "registrierung_already_admitted":
      return {
        schonAngekommen: true,
        error: buildRefusal({
          reason: "Deine Registrierung ist schon angekommen, und Dein Team hat Dich aufgenommen",
          repair: `Soll sich daran etwas ändern, schreib uns an ${KONTAKT_EMAIL}`,
        }),
      };
    // Neutral, and under the address it was judged on: a stranger learns nothing about a list, and
    // the person it does concern already knows why.
    case "registrierung_adresse_barred":
      return {
        fieldErrors: {
          email: `Mit dieser E-Mail-Adresse ist keine Registrierung möglich. Wenn Du das für einen Fehler hältst, schreib uns an ${KONTAKT_EMAIL}.`,
        },
      };
    default:
      return null;
  }
}

/** `alterAusserhalb` where the link's view serves no floor to name: both bounds, never a number of its own. */
const ALTER_AUSSERHALB_UNGELESEN = "Mit diesem Geburtsdatum bist Du zu jung oder zu alt.";

/**
 * The returning pupil's age refusal, judged on the date the league holds rather than one typed here: the page
 * has no field to correct, and every reopened link takes the same date, so the league is the repair.
 */
const GESPEICHERTES_GEBURTSDATUM_AUSSERHALB = buildRefusal({
  reason: "Dein bei uns gespeichertes Geburtsdatum liegt außerhalb der Altersgrenzen dieser Saison",
  repair: `Du siehst es in Deinem Konto. Stimmt es nicht, schreib uns an ${KONTAKT_EMAIL}`,
});

/** What one refused confirmation asks its caller to do. */
export type BestaetigungRefusal = { error?: string; fieldErrors?: FieldErrors; unplacedError?: string; zustand?: SpielerLinkZustand };

/** The link's own view, read again after a refused press: its floors where it is open, its state where not. A failed read is `null` beside it. */
export type GelesenerLink =
  | { readonly zustand: "valid"; readonly ansicht: { readonly minimum_age: number; readonly medien_minimum_age: number } }
  | { readonly zustand: SpielerLinkZustand };

// A THUNK and never a resolved read: the codes naming one state alone answer without it, and a caller
// reading the view in front of the switch spends a second backend read on each of them.
/**
 * A confirmation refusal as what the page should show, or `null` where the code is none of these.
 *
 * The floors are the token's own view's: a number of this mapper's own would state one the
 * endpoint is not using.
 */
export async function mapBestaetigungRefusal(
  error: unknown,
  gesendet: Pick<FLRegistrierungConfirmationPayload, "geburtsdatum">,
  gelesen: () => Promise<GelesenerLink | null>,
): Promise<BestaetigungRefusal | null> {
  if (!isRefusal(error)) return null;

  const ansicht = async () => {
    const link = await gelesen();
    return link?.zustand === "valid" ? link.ansicht : null;
  };
  // The panel a reload opens on, which the press's own panel stands in for where the read finds the link open or reads nothing.
  const stand = async (sonst: SpielerLinkZustand): Promise<SpielerLinkZustand> => {
    const link = await gelesen();
    return link === null || link.zustand === "valid" ? sonst : link.zustand;
  };

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal no box can take is of a drifted client, which the
    // mail's link replaces.
    case "body_unreadable":
    case "payload_refused":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // The switch is offered from the served age on the browser's day, so a clock disagreeing with the
    // backend's sends this, which a reopened link would offer again: switching it off is the repair.
    case "medien_age":
      return { error: medienNochNicht((await ansicht())?.medien_minimum_age ?? null) };
    // Answers the page did not ask: a drifted client, the label check refusing a page whose person
    // changed since it opened first. The mail's link reopens it.
    case "registrierung_choices_unsuitable":
      return { error: ANTWORT_NEU_OEFFNEN };
    // The backend's judgement of the label: a page opened before a
    // deploy moved it posts words other than those the backend runs, and only the mail's link reopens it.
    case "wording_not_allowed":
      return { error: FASSUNG_NEU_OEFFNEN };
    case "link_invalid":
      return { zustand: "invalid" };
    // Judged ahead of a confirmation and of the ban, which the view ranks first: a link confirmed in another window,
    // or an address barred since, reads as a reload shows it.
    case "link_expired":
      return { zustand: await stand("expired") };
    // Judged ahead of the ban, which the view ranks first.
    case "confirmation_exists":
      return { zustand: await stand("confirmed") };
    // The panel the view opens a barred link on, so a ban entered while the form stood open leaves no form either.
    case "link_barred":
      return { zustand: "barred" };
    // The one refusal that spends no token, so a typed date's refusal lands on its field and the date survives it;
    // a `zustand` here would swap a live form for a dead-link panel.
    case "confirmation_age": {
      // No date sent is the returning pupil's stored one judged: their page asks none (`registrierung_choices_unsuitable`).
      if (gesendet.geburtsdatum === null) return { error: GESPEICHERTES_GEBURTSDATUM_AUSSERHALB };

      const floor = (await ansicht())?.minimum_age ?? null;

      // A view that went unread names no floor: one guessed could send the person to correct a date that was right.
      return { fieldErrors: { geburtsdatum: floor === null ? ALTER_AUSSERHALB_UNGELESEN : alterAusserhalb(floor) } };
    }
    default:
      return null;
  }
}

/**
 * The administrator's list as its view receives it. Field by field and never a spread of the row: the
 * served row carries the pupil's address and birthdate, and a field the backend adds would ride
 * along to the browser unseen.
 */
export function buildAdminRegistrierungRows(registrierungen: readonly FLRegistrierung[], teams: readonly NamedTeam[]): AdminRegistrierungRow[] {
  const teamNamen = new Map(teams.map((team) => [team.id, team.name]));

  return registrierungen.map((registrierung) => ({
    id: registrierung.id,
    vorname: registrierung.vorname,
    nachname: registrierung.nachname,
    submitted_at: registrierung.submitted_at,
    team_id: registrierung.team_id,
    teamName: teamNamen.get(registrierung.team_id) ?? null,
    saison_id: registrierung.saison_id,
    stufe: registrierung.stufe,
    confirmed: registrierung.confirmed,
  }));
}

/** The registrations page with nothing pending: a decided queue and one nobody joined read alike. */
export const REGISTRIERUNGEN_LEER = "Keine offenen Registrierungen.";

/** Why an unconfirmed row offers no admission: its address is unverified until the pupil's own link is followed. */
export const NOCH_NICHT_BESTAETIGT = "Aufnehmen kannst Du erst, wenn die Person ihren Link bestätigt hat.";

/**
 * The same-person question. It names the stored person and never the differing values: the stored
 * birthdate was promised to the administrators alone.
 */
export const ANGABEN_WEICHEN_AB = "Die Angaben weichen von einem früheren Eintrag ab.";
export const dieselbePerson = (name: string): string => `Ist das dieselbe Person wie ${name}?`;

/** A registration another seat decided since the page was drawn: the press meets no pending row. */
export const REGISTRIERUNG_SCHON_ENTSCHIEDEN = buildRefusal({
  reason: "Diese Registrierung ist schon entschieden",
  repair: LADE_DIE_SEITE_NEU,
});

/**
 * A refused admission as the registrations page words it to a seat holder, or `null` for a code the
 * person spine answers. **The ban's refusal is neutral**: a team is never told that a pupil's address is barred.
 */
export function mapAufnahmeRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "document_not_found":
      return REGISTRIERUNG_SCHON_ENTSCHIEDEN;
    // The list marks the row and offers no press, so only a page older than the pupil's state sends this.
    case "registrierung_unconfirmed":
      return buildRefusal({
        reason: "Diese Registrierung ist noch nicht bestätigt",
        repair: "Nimm sie auf, sobald die Person ihren Link bestätigt hat",
      });
    case "registrierung_adresse_barred":
      return buildRefusal({ reason: "Diese Registrierung kann nicht aufgenommen werden", repair: "Wende Dich an die Liga" });
    case "registrierung_stufe_not_allowed":
      return buildRefusal({
        reason: "Diese Stufe ist in dieser Saison nicht zugelassen",
        repair: "Lehne die Registrierung ab oder wende Dich an die Liga",
      });
    // The page sends exactly the person the read resolved, so this is a page older than
    // the stored person it names.
    case "registrierung_person_not_named":
      return buildRefusal({
        reason: "Wen diese Registrierung meint, hat sich seit dem Laden der Seite geändert",
        repair: "Lade die Seite neu und entscheide erneut",
      });
    // The pupil confirmed as a person the league has erased since, and gave no answers a new person
    // could stand on: only a fresh registration asks them.
    case "registrierung_person_missing":
      return buildRefusal({
        reason: "Die Person zu dieser Registrierung ist bei uns nicht mehr gespeichert",
        repair: "Lehne die Registrierung ab. Die Person kann sich danach erneut registrieren",
      });
    case "registrierung_already_in_kader":
      return buildRefusal({
        reason: "Diese Person steht in dieser Saison schon in einem Kader",
        repair: "Lehne die Registrierung ab oder wende Dich an die Liga",
      });
    // The administrator's remedy, raising the cap, is no seat holder's: the league is.
    case "kader_full":
      return buildRefusal({
        reason: "Der Kader Deines Teams ist für diese Saison voll",
        repair: "Wende Dich an die Liga, wenn noch jemand dazukommen soll",
      });
    default:
      return null;
  }
}

/** A refused decline as the registrations page words it, or `null` for a code the person spine answers. */
export function mapAblehnungRefusal(error: unknown): string | null {
  if (!isRefusal(error)) return null;

  return error.serverErrorCode === "document_not_found" ? REGISTRIERUNG_SCHON_ENTSCHIEDEN : null;
}

/**
 * A refused read as the panel it renders, or `null` where the read failed instead.
 *
 * Every rule's refusal alike: a spent link answers its own state in a 200, so a refusal is a token
 * nothing could place.
 */
export function mapRegistrierungAnsichtRefusal(error: unknown): "invalid" | null {
  if (!isRefusal(error)) return null;

  // A token the backend will not parse matches no record, so the page calls the link void rather
  // than offering a reload that cannot succeed.
  if (error.serverErrorCode === "payload_refused") return "invalid";

  // The season or club an invitation names gone, which the invitation's read answers as the sign-up
  // does; the confirmation's read and write meet no gone record.
  if (isRecordMissing(error)) return "invalid";

  return isRuleRefusal(error) ? "invalid" : null;
}
