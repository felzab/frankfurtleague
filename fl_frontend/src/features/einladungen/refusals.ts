import { APIBadStatusError } from "@/core/errors";
import { buildRefusal } from "@/shared/utils/refusal";

import type { FieldErrors } from "@/shared/utils/validation";

/**
 * **The mint and the season-wide send share this mapper**: the rules are
 * the season's and the junction's, and which press met one is nothing an administrator acts on
 * differently.
 */
export function mapEinladungRefusal(error: unknown): { error?: string; fieldErrors?: FieldErrors } | null {
  if (!(error instanceof APIBadStatusError) || error.statusCode !== 409) return null;

  switch (error.serverErrorCode) {
    case "REQ-EINLADUNG-001":
      return {
        error: buildRefusal({
          reason: "Dieses Team steht nicht in dieser Saison",
          repair: "Nimm es zuerst in die Saison auf",
          where: "Saison",
        }),
      };
    case "REQ-EINLADUNG-002":
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
