import type { FLSpielbestaetigungClosedGrund } from "@/core/generated/client/types";
import type { FeedbackTone } from "@/shared/components/ui/badges";

// The triage's own word for the seat (`ACTION_REQUIRED_LABELS.schiedsrichter_missing`): a chip row has no room for a longer one.
export const SCHIEDSRICHTER_PARTEI = "Schiedsrichter";

/** Where a party stands on the fixture's current Ansetzung, as the administrator's chip says it. */
export type AntwortStand = "offen" | "zugesagt" | "declined" | "ueberfaellig" | "discarded";

// „Abgelehnt“ for every decline, a club's or a referee's: „Abgesagt“ is the status chip's word for a called-off
// fixture on the same card. The triage's note beside a chip wears its tone. A discard counts as agreement publicly.
export const ANTWORT_LABELS = {
  offen: { label: "Offen", tone: "info" },
  zugesagt: { label: "Zugesagt", tone: "success" },
  declined: { label: "Abgelehnt", tone: "warning" },
  ueberfaellig: { label: "Überfällig", tone: "warning" },
  discarded: { label: "Verworfen", tone: "success" },
} as const satisfies Record<AntwortStand, { label: string; tone: FeedbackTone }>;

// `verworfen` in the discard control's own word, so the readout and the press name one act alike; a referee's own
// decline in the answer's word above, never „abgesagt“, which `abgesagt` here says of a called-off fixture.
export const SCHLIESSGRUND_LABELS: Record<FLSpielbestaetigungClosedGrund, string> = {
  ansetzung_changed: "Termin geändert",
  austritt: "Team ausgetreten",
  spiel_decided: "Spiel entschieden",
  abgesagt: "Spiel abgesagt",
  schiedsrichter_switched: "Schiedsrichter gewechselt",
  schiedsrichter_declined: "Schiedsrichter hat abgelehnt",
  discarded: "Vorschlag verworfen",
  spiel_past: "Spieltag vorbei",
};
