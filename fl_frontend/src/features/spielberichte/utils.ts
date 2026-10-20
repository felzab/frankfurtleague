import { kaderName, NUMMER_NICHT_HINTERLEGT, SPIELER_ANONYM_LABEL } from "@/features/spieler/constants";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal, LADE_DIE_SEITE_NEU } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";
import type { FLSpielberichtSpieler } from "./schemas";

/** A pupil as a report's reader sees them: shirt number and name, and the erased pupils' sentinel as „anonym“. */
export function spielerLabel(spieler: FLSpielberichtSpieler): string {
  if (spieler.vorname === null) return SPIELER_ANONYM_LABEL;

  return `${spieler.nummer ?? NUMMER_NICHT_HINTERLEGT} · ${kaderName({ vorname: spieler.vorname, nachname: spieler.nachname })}`;
}

/** Who reads the sentence: the booked referee on their panel, or an administrator correcting the report. */
export type SpielberichtLeser = "schiedsrichter" | "admin";

/** The remarks' name refusal lands on the box, the one control that can repair it. */
export const BEMERKUNGEN_PATH = "bericht.bemerkungen";

const NAME_IN_BEMERKUNGEN = "In den Bemerkungen steht ein Name. Beschreib die Person ohne Namen, etwa mit der Rückennummer.";

const SAETZE: Record<SpielberichtLeser, Readonly<Record<string, string>>> = {
  schiedsrichter: {
    // Ahead of the spine's own reading, whose sentence names a team: the referee's record is what went.
    "REQ-FUNKTION-001": "Du bist nicht mehr als Schiedsrichter eingetragen. Lade die Seite neu.",
    "REQ-BERICHT-001": buildRefusal({ reason: "Dieses Spiel hat noch kein Datum oder noch nicht stattgefunden", repair: LADE_DIE_SEITE_NEU }),
    "REQ-BERICHT-002": buildRefusal({ reason: "Dieses Spiel leitest Du nicht mehr", repair: LADE_DIE_SEITE_NEU }),
    "REQ-BERICHT-003": buildRefusal({
      reason: "Eine gewählte Person steht nicht mehr im Kader ihres Teams",
      repair: "Lade die Seite neu und wähle neu",
    }),
    "REQ-BERICHT-004": "Dieses Spiel ist ausgefallen oder annulliert. Dafür gibt es keinen Spielbericht.",
    "DB-COMMON-002": buildRefusal({ reason: "Der Spielbericht wurde gerade gleichzeitig gespeichert", repair: LADE_DIE_SEITE_NEU }),
  },
  admin: {
    "REQ-BERICHT-001": buildRefusal({ reason: "Das Spiel hat noch kein Datum oder liegt in der Zukunft", repair: "Trag zuerst das Datum ein" }),
    "REQ-BERICHT-003": buildRefusal({
      reason: "Eine gewählte Person steht nicht im Kader ihres Teams",
      repair: "Lade die Seite neu und wähle neu",
    }),
    "REQ-BERICHT-004": "Das Spiel ist als ausgefallen oder annulliert eingetragen. Dafür gibt es keinen Spielbericht.",
    "DB-COMMON-002": buildRefusal({ reason: "Der Spielbericht wurde gerade gleichzeitig gespeichert", repair: LADE_DIE_SEITE_NEU }),
  },
};

/** A report write's refusal in its reader's words, `null` for a code neither write answers. */
export function mapSpielberichtRefusal(error: unknown, leser: SpielberichtLeser): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error) || error.serverErrorCode === undefined) return null;

  if (error.serverErrorCode === "REQ-BERICHT-005") return { fieldErrors: { [BEMERKUNGEN_PATH]: NAME_IN_BEMERKUNGEN } };

  const saetze = SAETZE[leser];
  // Own keys alone, so a code spelling an inherited member never reads as worded.
  return Object.hasOwn(saetze, error.serverErrorCode) ? { error: saetze[error.serverErrorCode] } : null;
}
