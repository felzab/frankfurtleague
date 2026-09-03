import { revalidateTag } from "next/cache";

import { APIBadStatusError } from "@/core/errors";
import { patchSaison } from "@/features/saisons/mutations";
import { FLPatchSaisonPayloadSchema } from "@/features/saisons/schemas";
import { handleUndoRequest } from "@/shared/utils/undoRoute";

import type { NextRequest } from "next/server";

/** The refusals a replay can meet, in German written for the undo — the save's own words name a field this toast has not got. */
const REPLAY_REFUSALS: Record<string, string> = {
  "REQ-DATE-004": "Mindestens ein Spieltag liegt außerhalb des ursprünglichen Zeitraums.",
  "REQ-DATE-005": "Der ursprüngliche Zeitraum ist zu kurz für die Spieltage, die diese Saison nach ihren Regeln braucht.",
  "REQ-RULES-001": "Die ursprünglichen Zahlen für Gruppen und Qualifikanten ergeben keine KO-Runde, die diese Saison spielen kann.",
  "REQ-RULES-002": "Die ursprüngliche Zahl der Gruppen lässt eine Gruppe wegfallen, die inzwischen Teams hält.",
  "REQ-RULES-003": "Mindestens eine Gruppe hält inzwischen mehr Teams, als die ursprüngliche Zahl je Gruppe zulässt.",
  "REQ-RULES-004": "Ein Platz im KO-Baum verweist auf eine Platzierung, die es bei der ursprünglichen Zahl der Qualifikanten nicht gibt.",
  "REQ-RULES-005": "Diese Saison ist inzwischen abgeschlossen, deshalb sind Punkte, Tiebreak und Qualifikanten festgeschrieben.",
  "REQ-RULES-006": "Mindestens ein Spieltag enthält mehr Spiele, als die ursprünglichen Regeln vorsehen.",
  "REQ-RULES-007": "Die ursprünglichen Regeln qualifizieren mehr Teams aus einer Gruppe, als die Gruppe fasst.",
  "REQ-RULES-008": "Bei den ursprünglichen Punkten bringt ein Unentschieden mehr als ein Sieg.",
  "REQ-RULES-009": "Mindestens ein Kader hat inzwischen mehr Spieler, als die ursprüngliche maximale Kadergröße zulässt.",
  "REQ-RULES-010": "Diese Saison spielt eine KO-Runde, und das ursprüngliche Ergebnis für ein Nichtantreten bringt niemanden weiter.",
  "REQ-RULES-011": "Für diese Saison sind inzwischen Spiele angesetzt, deshalb stehen Gruppen, Teams pro Gruppe und Qualifikanten fest.",
  "REQ-RULES-012": "Die KO-Runde dieser Saison hat inzwischen begonnen, deshalb ist der Tiebreak festgeschrieben.",
};

/** The second half of every refusal above: a cause alone leaves the admin unsure what the season now holds. */
const CHANGE_STANDS = "Die Änderung steht weiterhin.";

export async function POST(request: NextRequest) {
  return handleUndoRequest(request, {
    mutationName: "undoAdminSaisonEdit",
    schema: FLPatchSaisonPayloadSchema,
    restore: async (payload) => {
      let operation;
      try {
        operation = await patchSaison(payload);
      } catch (error) {
        const code = error instanceof APIBadStatusError && error.statusCode === 409 ? error.serverErrorCode : undefined;
        const refusal = code == null ? undefined : REPLAY_REFUSALS[code];
        if (refusal === undefined) throw error;

        return `${refusal} ${CHANGE_STANDS}`;
      }

      return operation.acknowledged ? undefined : "Die Rücknahme wurde abgebrochen. Prüfe die Saisondaten.";
    },
    invalidate: () => {
      revalidateTag("saisons", { expire: 0 });
      revalidateTag("teams", { expire: 0 });
    },
  });
}
