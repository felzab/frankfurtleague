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
  | { zustand: "abgelaufen" | "ungueltig" | "gesperrt" };

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

/** The name refusal on the reason box, on the erasure reason's pattern: the sentence names no matched person. */
export const NAME_IN_BEGRUENDUNG = "Die Begründung enthält ein Wort, das dem Namen einer beteiligten Person gleicht.";

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
    // A token nothing stores, a voided seat's included, a fixture moved since the link, and a row closed
    // unanswered for whatever reason, which one code covers: one panel, which tells a guessed link
    // nothing about a row.
    case "REQ-ANSETZUNG-001":
    case "REQ-ANSETZUNG-004":
    case "REQ-ANSETZUNG-009":
      return { zustand: "ungueltig" };
    case "REQ-ANSETZUNG-003":
    case "REQ-ANSETZUNG-005":
      return { zustand: "abgelaufen" };
    // One code covers both answers, so „zugesagt“ here would tell a club that declined in another
    // window that it confirmed. Which way it went, and from which seat, is the read's to say.
    case "REQ-ANSETZUNG-002":
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
          repair: "Schlag einen anderen Tag vor, oder eine Uhrzeit mit mindestens vier Stunden Abstand",
        }),
      };
    case "REQ-ANSETZUNG-012":
      return { fieldErrors: { begruendung: NAME_IN_BEGRUENDUNG } };
    default:
      return null;
  }
}
