import { isRecordMissing } from "@/core/errors";
import { spieltageGetSpieltagVerwaltung } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpieltagAdminResponse } from "@/core/generated/client/types";

/**
 * One matchday by its id for its editor, a planned season's included, with the `version` its save sends back and its
 * phase's count of matchdays its name is read with, beside its season's status, by which the editor opens a finished
 * season's read-only, as the match editor's read does; `null` where no matchday holds the id, which the editor answers
 * with its not-found page. **Uncached**, as every admin read.
 */
export async function getAdminSpieltag(spieltagId: string): Promise<FLSpieltagAdminResponse | null> {
  return runAdminRead(() =>
    spieltageGetSpieltagVerwaltung(spieltagId).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  );
}
