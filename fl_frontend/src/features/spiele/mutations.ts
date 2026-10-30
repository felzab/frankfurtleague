import { spielePatchSpielData } from "@/core/generated/client/sdk";

import type { FLPatchSpielDataPayload, FLPatchSpielDataResponse } from "@/core/generated/client/types";

/**
 * The payload the old match form sends: the write's body beside the fixture it names. `uebernimmtBericht` is the
 * Spielbericht `version` the editor was seeded from, which the save stamps adopted.
 */
export const patchAdminSpielData = async (
  { spiel_id, ...fields }: FLPatchSpielDataPayload & { spiel_id: string },
  uebernimmtBericht: number | null,
): Promise<FLPatchSpielDataResponse> =>
  // Left out unseeded: sent, it adopts whatever report stands at that version.
  spielePatchSpielData(spiel_id, fields, uebernimmtBericht === null ? {} : { uebernimmt_bericht: uebernimmtBericht });

/**
 * **Deliberately the same endpoint, payload and answer as the save.** Its own would be a second implementation of
 * the refusal rules, and once the two disagreed the warning would name the wrong fixtures — worse than none.
 */
export const previewAdminSpielData = async ({
  spiel_id,
  ...fields
}: FLPatchSpielDataPayload & { spiel_id: string }): Promise<FLPatchSpielDataResponse> =>
  // Sent as changing nothing, so the spine clears no cached read on a keystroke.
  spielePatchSpielData(spiel_id, fields, { dry_run: true }, { readOnly: true });
