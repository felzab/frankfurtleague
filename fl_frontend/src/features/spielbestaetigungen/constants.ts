import type { FeedbackTone } from "@/shared/components/ui/badges";
import type { FLSpielbestaetigungGrund } from "./schemas";

// The triage's own word for the seat (`ACTION_REQUIRED_LABELS.schiedsrichter_missing`): a chip row has no room for a longer one.
export const SCHIEDSRICHTER_PARTEI = "Schiedsrichter";

/** Where a party stands on the fixture's current Ansetzung, as the administrator's chip says it. */
export type AntwortStand = "offen" | "zugesagt" | "abgelehnt" | "ueberfaellig";

// „Abgelehnt“ for every decline, a club's or a referee's: „Abgesagt“ is the status chip's word for a called-off
// fixture on the same card.
export const ANTWORT_LABELS: Record<AntwortStand, { label: string; tone: FeedbackTone }> = {
  offen: { label: "Offen", tone: "info" },
  zugesagt: { label: "Zugesagt", tone: "success" },
  abgelehnt: { label: "Abgelehnt", tone: "warning" },
  ueberfaellig: { label: "Überfällig", tone: "danger" },
};

// `verworfen` in the discard control's own word, so the readout and the press name one act alike; a referee's own
// decline in the answer's word above, never „abgesagt“, which `abgesagt` here says of a called-off fixture.
export const SCHLIESSGRUND_LABELS: Record<FLSpielbestaetigungGrund, string> = {
  ansetzung_geaendert: "Termin geändert",
  austritt: "Team ausgetreten",
  spiel_entschieden: "Spiel entschieden",
  abgesagt: "Spiel abgesagt",
  schiedsrichter_gewechselt: "Schiedsrichter gewechselt",
  schiedsrichter_abgelehnt: "Schiedsrichter hat abgelehnt",
  verworfen: "Vorschlag verworfen",
  spiel_vergangen: "Spieltag vorbei",
};
