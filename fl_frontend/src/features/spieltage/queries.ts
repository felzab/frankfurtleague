import { isRecordMissing } from "@/core/errors";
import { spieltageGetSpieltagVerwaltung } from "@/core/generated/client/sdk";
import { runAdminRead } from "@/shared/utils/adminRead";

import type { FLSpieltagAdmin } from "@/core/generated/client/types";

/**
 * One matchday by its id for its editor, a planned season's included, with the `version` its save sends back and its
 * phase's count of matchdays its name is read with; `null` where no matchday holds the id, which the editor answers
 * with its not-found page. **Uncached**, as every admin read.
 */
export async function getAdminSpieltag(spieltagId: string): Promise<FLSpieltagAdmin | null> {
  return runAdminRead(() =>
    spieltageGetSpieltagVerwaltung(spieltagId).then(
      ({ spieltag }) => spieltag,
      (error: unknown) => {
        if (isRecordMissing(error)) return null;
        throw error;
      },
    ),
  );
}
