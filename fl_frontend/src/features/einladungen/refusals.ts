import { SAISON_ABSCHNITT } from "@/features/teams/constants";
import { isRefusal } from "@/shared/utils/actionError";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * **The mint and the season-wide send share this mapper**: the rules are
 * the season's and the junction's, and which press met one is nothing an administrator acts on
 * differently.
 */
export function mapEinladungRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!isRefusal(error)) return null;

  switch (error.serverErrorCode) {
    case "einladung_team_nicht_eingetragen":
      return {
        error: buildRefusal({
          reason: "Dieses Team steht nicht in dieser Saison",
          repair: { before: "Nimm es zuerst", after: "auf" },
          where: SAISON_ABSCHNITT,
        }),
      };
    case "saison_past":
      return {
        error: buildRefusal({
          reason: "Diese Saison ist abgeschlossen, und für eine abgeschlossene Saison gibt es keine Registrierungslinks mehr",
          repair: "Wähle eine laufende oder geplante Saison",
        }),
      };
    default:
      return null;
  }
}
