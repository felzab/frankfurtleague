import { CLASH_BUFFER_TEXT } from "@/features/spiele/constants";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSpielbestaetigungAnsichtResponse, FLSpielbestaetigungVon } from "./schemas";

/**
 * What one link opens, narrowed before the page: an answerable link carries the whole view, an
 * answered one the role that answered and nothing else, every other state the state alone.
 */
export type SpielbestaetigungAnsicht =
  // A member per state, never one for the pair: a union keyed on a union of literals narrows on neither.
  | { zustand: "gueltig"; ansicht: FLSpielbestaetigungAnsichtResponse }
  | { zustand: "vorschlag"; ansicht: FLSpielbestaetigungAnsichtResponse }
  | { zustand: "zugesagt"; beantwortet_von: FLSpielbestaetigungVon }
  | { zustand: "abgelehnt"; beantwortet_von: FLSpielbestaetigungVon }
  // `termin-vorbei` is the page's own: an `abgelaufen` link whose fixture's day has gone by.
  | { zustand: "abgelaufen" | "termin-vorbei" | "ungueltig" | "gesperrt" };

/** Every state a link opens on once no press can spend it. */
export type SpielbestaetigungLinkZustand = Exclude<SpielbestaetigungAnsicht["zustand"], "gueltig" | "vorschlag">;

/** A press the backend refused, as the route answers it: a link's state, a box's message, or a sentence. */
export type SpielbestaetigungRefusal = {
  error?: string;
  fieldErrors?: FieldErrors;
  unplacedError?: string;
  zustand?: SpielbestaetigungLinkZustand;
  /** The route's instruction to read the link back, never a key the page receives. */
  nachlesen?: true;
};

/**
 * A refused read as the panel it renders, or `null` where the read failed instead.
 *
 * A token the backend will not parse matches no row, so the page calls the link void rather than
 * offering a reload that cannot succeed.
 */
export function mapAnsetzungAnsichtRefusal(error: unknown): "ungueltig" | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "REQ-VAL-001") return "ungueltig";

  // Every rule's refusal alike: a spent link answers its own `zustand` in a 200, so a refusal is a
  // token nothing could place, and a code nobody planned reads the same way.
  return isRuleRefusal(error) ? "ungueltig" : null;
}

/**
 * The answer's refusals, worded once for every page that sends one. `null` where the code is none of
 * these, which the route lets reach its spine.
 */
export function mapAnsetzungRefusal(error: unknown): SpielbestaetigungRefusal | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal no box can take is of a drifted client, which the
    // mail's link replaces.
    case "REQ-VAL-002":
    case "REQ-VAL-001":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // A token nothing stores, a voided seat's included, and a fixture moved since the link: one panel,
    // which tells a guessed link nothing about a row.
    case "REQ-ANSETZUNG-001":
    case "REQ-ANSETZUNG-004":
      return { zustand: "ungueltig" };
    case "REQ-ANSETZUNG-003":
    case "REQ-ANSETZUNG-005":
      return { zustand: "abgelaufen" };
    // Each covers several states the read tells apart: `-002` both answers, where „zugesagt“ would tell a
    // club that declined in another window it confirmed; `-009` every closing reason, so the press shows
    // the panel a reload would.
    case "REQ-ANSETZUNG-002":
    case "REQ-ANSETZUNG-009":
      return { nachlesen: true };
    // The panel the view opens a barred link on, so a ban entered while the form stood open leaves no form either.
    case "REQ-ANSETZUNG-011":
      return { zustand: "gesperrt" };
    // The proposal's refusals spend nothing: each lands on the box that caused it, and the typed
    // proposal survives it.
    case "REQ-ANSETZUNG-007":
      return { fieldErrors: { "vorschlag.datum": "Dieses Datum liegt in der Vergangenheit." } };
    case "REQ-DATE-001":
      return { fieldErrors: { "vorschlag.datum": "Dieses Datum liegt außerhalb des Spieltags." } };
    case "REQ-ELIGIBILITY-001":
      return { fieldErrors: { "vorschlag.datum": "An diesem Datum spielt eines der beiden Teams nicht mehr in der Saison." } };
    // The failure names neither the venue nor the referee, and either moves with the date as much as
    // with the time, so no one box takes it.
    case "REQ-CLASH-001":
      return {
        error: buildRefusal({
          reason: "Zu dieser Zeit ist der Spielort oder die Schiedsrichterin oder der Schiedsrichter schon für ein anderes Spiel eingeteilt",
          repair: `Schlag einen anderen Tag vor, oder eine Uhrzeit mit mindestens ${CLASH_BUFFER_TEXT} Abstand`,
        }),
      };
    default:
      return null;
  }
}
