import { CLASH_BUFFER_TEXT } from "@/features/spiele/constants";
import { KONTAKT_ROLLEN } from "@/features/teams/constants";
import { isRefusal, isRuleRefusal, refusedPayloadAnswer } from "@/shared/utils/actionError";
import { formatSpielDatum, formatUhrzeit, NICHT_HINTERLEGT } from "@/shared/utils/format";
import { buildRefusal } from "@/shared/utils/refusal";
import { ANTWORT_NEU_OEFFNEN } from "@/shared/utils/reopenLink";

import type { FLSpielbestaetigungAppointment, FLSpielbestaetigungViewResponse, FLSpielbestaetigungVon } from "@/core/generated/client/types";
import type { FieldErrors } from "@/shared/utils/validation";

/** Who answered, as a readout rather than a sentence: a seat's long label agrees with no one article. */
export function beantwortetVon(von: FLSpielbestaetigungVon): string {
  if (von.art === "admin") return "Verwaltung der Liga";
  if (von.art === "schiedsrichter") return "Schiedsrichterin oder Schiedsrichter";
  return KONTAKT_ROLLEN.find((entry) => entry.value === von.rolle)?.langform ?? NICHT_HINTERLEGT;
}

export const terminText = (termin: FLSpielbestaetigungAppointment): string =>
  `${formatSpielDatum(termin.datum)} um ${formatUhrzeit(termin.uhrzeit)} Uhr`;

/**
 * What one link opens, narrowed before the page: an answerable link carries the whole view, an
 * answered one the role that answered and nothing else, every other state the state alone.
 */
export type SpielbestaetigungAnsicht =
  // A member per state, never one for the pair: a union keyed on a union of literals narrows on neither.
  | { zustand: "valid"; ansicht: FLSpielbestaetigungViewResponse }
  | { zustand: "vorschlag"; ansicht: FLSpielbestaetigungViewResponse }
  | { zustand: "zugesagt"; answered_by: FLSpielbestaetigungVon }
  | { zustand: "declined"; answered_by: FLSpielbestaetigungVon }
  // The date the league kept, which its sentence points at: the link's mail named it already.
  | { zustand: "discarded"; appointment: FLSpielbestaetigungAppointment }
  // `termin-vorbei` is the page's own: an `abgelaufen` link whose fixture's day has gone by.
  | { zustand: "expired" | "termin-vorbei" | "invalid" | "abgesagt" | "barred" };

/** Every state a link opens on once no press can spend it. */
export type SpielbestaetigungLinkZustand = Exclude<SpielbestaetigungAnsicht["zustand"], "valid" | "vorschlag">;

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
export function mapAnsetzungAnsichtRefusal(error: unknown): "invalid" | null {
  if (!isRefusal(error)) return null;

  if (error.serverErrorCode === "payload_refused") return "invalid";

  // Every rule's refusal alike: a spent link answers its own `zustand` in a 200, so a refusal is a
  // token nothing could place, and a code nobody planned reads the same way.
  return isRuleRefusal(error) ? "invalid" : null;
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
    case "body_unreadable":
    case "payload_refused":
      return refusedPayloadAnswer(error, ANTWORT_NEU_OEFFNEN);
    // A token nothing stores, a voided seat's included, and a fixture moved since the link: one panel,
    // which tells a guessed link nothing about a row.
    case "link_invalid":
    case "ansetzung_changed":
      return { zustand: "invalid" };
    // Each covers several states the read tells apart: `ansetzung_answered` both answers, where „zugesagt“ would tell a
    // club that declined in another window it confirmed; `ansetzung_closed` every closing reason, so the press shows
    // the panel a reload would.
    case "ansetzung_answered":
    case "ansetzung_closed":
    // Spent either way, but only the read carries whether the fixture's day has gone by, which has a panel of its own.
    case "ansetzung_frist_past":
    case "ansetzung_decided":
      return { nachlesen: true };
    // The panel the view opens a barred link on, so a ban entered while the form stood open leaves no form either.
    case "link_barred":
      return { zustand: "barred" };
    // The proposal's refusals spend nothing: each lands on the box that caused it, and the typed
    // proposal survives it.
    case "ansetzung_vorschlag_past":
      return { fieldErrors: { "vorschlag.datum": "Dieses Datum liegt in der Vergangenheit." } };
    case "ansetzung_vorschlag_unchanged":
      return { fieldErrors: { "vorschlag.datum": "Das ist schon der angesetzte Termin." } };
    case "spiel_outside_spieltag":
      return { fieldErrors: { "vorschlag.datum": "Dieses Datum liegt außerhalb des Spieltags." } };
    case "eligibility_disqualified":
      return { fieldErrors: { "vorschlag.datum": "An diesem Datum spielt eines der beiden Teams nicht mehr in der Saison." } };
    // The failure names neither the venue nor the referee, and either moves with the date as much as
    // with the time, so no one box takes it.
    case "spiel_double_booked":
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

/** A referee's two answers' toast titles, each failure the negation of its success. */
export const ZUSAGE_GESPEICHERT = "Deine Zusage ist gespeichert";
export const ZUSAGE_NICHT_GESPEICHERT = "Deine Zusage wurde nicht gespeichert";
export const ABSAGE_GESPEICHERT = "Deine Absage ist gespeichert";
export const ABSAGE_NICHT_GESPEICHERT = "Deine Absage wurde nicht gespeichert";

/** Every spent row's repair: the panel re-read shows the row as it stands, which a refused press never redraws. */
const NEU_LADEN = "Lade die Seite neu.";

/**
 * A referee's answer's refusals, as their own panel words them: the link page's column reads a club's link, which a
 * referee holds none of. `null` where the code is none of these, which the person spine answers.
 */
export function mapSchiedsrichterAntwortRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors; unplacedError?: string } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    // The body shape is mirrored, so a refusal the reason box cannot take is of a page older than the running one.
    case "body_unreadable":
    case "payload_refused":
      return refusedPayloadAnswer(error, "Lade die Seite neu und antworte erneut.");
    // Ahead of the shared reader's sentence, which names a team.
    case "role_not_held":
      return { error: `Du bist nicht mehr als Schiedsrichterin oder Schiedsrichter eingetragen. ${NEU_LADEN}` };
    case "ansetzung_foreign_row":
      return { error: `Für dieses Spiel bist Du nicht eingeteilt. ${NEU_LADEN}` };
    case "ansetzung_answered":
      // The league may have entered the Zusage for the referee, so the sentence names no one answerer.
      return { error: `Diese Einteilung ist schon beantwortet, von Dir oder von der Verwaltung. ${NEU_LADEN}` };
    case "ansetzung_closed":
      return { error: `Diese Einteilung ist schon abgeschlossen. ${NEU_LADEN}` };
    case "ansetzung_decided":
      return { error: `Das Spiel ist entschieden oder abgesagt, oder ein Team spielt nicht mehr mit. ${NEU_LADEN}` };
    case "ansetzung_changed":
      return { error: `Das Spiel hat einen neuen Termin, oder Du bist nicht mehr eingeteilt. ${NEU_LADEN}` };
    // A referee's answer keeps no deadline, so the day alone spends it.
    case "ansetzung_frist_past":
      return { error: `Das Spiel liegt schon in der Vergangenheit. ${NEU_LADEN}` };
    default:
      return null;
  }
}
