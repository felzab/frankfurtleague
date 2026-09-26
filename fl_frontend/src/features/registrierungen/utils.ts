import { KONTAKT_EMAIL } from "@/core/brand";
import { isRecordMissing } from "@/core/errors";
import { nummerPayload } from "@/features/spieler/utils";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";
import { ANTWORT_NEU_OEFFNEN, REGISTRIERUNG_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import { alterAusserhalb, REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE } from "./constants";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLEinladungAnsichtResponse, FLPostRegistrierungPayload } from "./schemas";
import type { RegistrierungFormDraft, SpielerLinkZustand } from "./types";

/**
 * Which state the invite puts the registration page in.
 *
 * A link pasted after the window closed has to read „geschlossen“, or its holder goes away
 * believing an administrator revoked it. `laeuft` is the server's whole judgement.
 */
export function einladungZustand(ansicht: FLEinladungAnsichtResponse): "gueltig" | "geschlossen" {
  return ansicht.laeuft ? "gueltig" : "geschlossen";
}

/**
 * Which verdict of the read closes the form, in the order a reader can act on.
 *
 * A shut window outranks the rest; a missing team is the team's own to repair; a full squad reopens
 * when a place falls free.
 */
export function formularZustand(ansicht: FLEinladungAnsichtResponse): "gueltig" | "geschlossen" | "team-fehlt" | "kader-voll" {
  if (!ansicht.laeuft) return "geschlossen";
  if (!ansicht.team_eingetragen) return "team-fehlt";

  return ansicht.kader_frei ? "gueltig" : "kader-voll";
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
): { error?: string; fieldErrors?: FieldErrors; unplacedError?: string; zustand?: "ungueltig"; schonAngekommen?: true } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // Every body rule the form can break is mirrored, so a refusal no box can take is of a drifted
    // client, which the team's link replaces.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, REGISTRIERUNG_NEU_OEFFNEN);
    // The link died between the page loading and this press, and the whole page is the answer: a
    // banner over a form nothing accepts invites a second attempt.
    case "REQ-EINLADUNG-003":
    // With the record missing, the season or the club the link names is gone: as dead a link.
    case "DB-COMMON-001":
      return { zustand: "ungueltig" };
    // Each reachable only where the season moved after this page loaded, and the team's link reopens
    // onto a page read since: the window's or the team's own panel, or the Stufen offered now.
    case "REQ-REGISTRIERUNG-001":
    case "REQ-REGISTRIERUNG-002":
    case "REQ-REGISTRIERUNG-003":
      return { error: REGISTRIERUNG_NEU_OEFFNEN };
    case "REQ-REGISTRIERUNG-008":
      return {
        error: buildRefusal({
          reason: "Der Kader dieses Teams ist voll",
          repair: "Wende Dich an Dein Team, wenn Du trotzdem mitspielen sollst",
        }),
      };
    // The press this form repeated stands, under the details first sent: a banner rather than a
    // field, since whichever box changed since then is not the one at fault.
    case "REQ-REGISTRIERUNG-011":
      return {
        schonAngekommen: true,
        error: buildRefusal({
          reason: "Deine Registrierung ist schon angekommen, mit den Angaben, die Du zuerst abgeschickt hast",
          repair: `Soll sich daran etwas ändern, schreib uns an ${KONTAKT_EMAIL}`,
        }),
      };
    // Neutral, and under the address it was judged on: a stranger learns nothing about a list, and
    // the person it does concern already knows why.
    case "REQ-REGISTRIERUNG-009":
      return {
        fieldErrors: {
          email: `Mit dieser E-Mail-Adresse ist keine Registrierung möglich. Wenn Du das für einen Fehler hältst, schreib uns an ${KONTAKT_EMAIL}.`,
        },
      };
    default:
      return null;
  }
}

/**
 * What a pupil is told where the provider refused their confirmation mail outright.
 *
 * It names a second attempt because the write refuses nothing on the strength of a pending row:
 * registering again mints a fresh link.
 */
export const MAIL_ABGEWIESEN =
  "An diese Adresse konnten wir keine E-Mail schicken. Prüfe sie und registriere Dich über denselben Link noch einmal; " +
  `der Eintrag von eben löscht sich nach ${String(REGISTRIERUNG_BESTAETIGUNG_FRIST_TAGE)} Tagen von selbst.`;

/** The refused send as the form shows it. */
export function abgewiesenerVersand(): { error?: string; fieldErrors?: FieldErrors } {
  return { fieldErrors: { email: MAIL_ABGEWIESEN } };
}

/** What one refused confirmation asks its caller to do. */
export type BestaetigungRefusal = { error?: string; fieldErrors?: FieldErrors; unplacedError?: string; zustand?: SpielerLinkZustand };

// A THUNK and never a resolved number: three of the four codes below are link states, and a
// caller reading the floor in front of the switch spends a second backend read on every one of
// them.
/**
 * A confirmation refusal as what the page should show, or `null` where the code is none of these.
 *
 * The floor is the token's own view's: a number of this mapper's own would state one the
 * endpoint is not using.
 */
export async function mapBestaetigungRefusal(error: unknown, mindestalter: () => Promise<number | null>): Promise<BestaetigungRefusal | null> {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal no box can take is of a drifted client, which the
    // mail's link replaces.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // The page offers no media switch below the served age, so only a page older than that rule
    // sends this answer, and its repair is the refused payload's.
    case "REQ-REGISTRIERUNG-010":
      return { error: ANTWORT_NEU_OEFFNEN };
    // With the record missing, the registration the link names is gone, which is a link nothing places.
    case "DB-COMMON-001":
    case "REQ-REGISTRIERUNG-004":
      return { zustand: "ungueltig" };
    case "REQ-REGISTRIERUNG-005":
      return { zustand: "abgelaufen" };
    case "REQ-REGISTRIERUNG-006":
      return { zustand: "bestaetigt" };
    // The one refusal that spends no token, so it lands on the field and the typed date survives it;
    // a `zustand` here would swap a live form for a dead-link panel.
    case "REQ-REGISTRIERUNG-007": {
      const floor = await mindestalter();

      // Unworded rather than guessed: a sentence naming a floor this link was not minted under
      // sends the person to correct a date that was right.
      return floor === null ? null : { fieldErrors: { geburtsdatum: alterAusserhalb(floor) } };
    }
    default:
      return null;
  }
}

/**
 * A refused read as the panel it renders, or `null` where the read failed instead.
 *
 * Every rule's refusal alike: a spent link answers its own state in a 200, so a refusal is a token
 * nothing could place.
 */
export function mapRegistrierungAnsichtRefusal(error: unknown): "ungueltig" | null {
  if (!isRefusal(error)) return null;

  // A token the backend will not parse matches no record, so the page calls the link void rather
  // than offering a reload that cannot succeed.
  if (error.serverErrorCode === "REQ-VAL-001") return "ungueltig";

  // The season, club or registration the link names gone, which the writes answer alike.
  if (isRecordMissing(error)) return "ungueltig";

  return isRuleRefusal(error) ? "ungueltig" : null;
}
