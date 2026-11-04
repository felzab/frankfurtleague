import { connection } from "next/server";

import { getAdminSaisons } from "../../queries";
import { selectSaison } from "../../resolvers";
import { SaisonSelector } from "./SaisonSelector";

import type { FLSaison } from "@/core/generated/client/types";
import type { SaisonSelectorOption } from "../../types";

/** Id and range only — the whole of what the switcher renders, and the whole of what may cross into it. */
const asOption = ({ id, start_date, end_date }: FLSaison): SaisonSelectorOption => ({ id, start_date, end_date });

/**
 * The admin shell's season switcher. It offers a planned season, which every base-tier read withholds: a season is
 * created planned, and that is the only window a club has to be entered into it.
 */
export async function SaisonMetadataDisplay() {
  await connection();

  // Its read sends a session that is no administrator's to the sign-in landing
  // (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
  const { saisons } = await getAdminSaisons();
  // The pages' own default off the list they read in this request, never the cached current season,
  // which a write outside the app leaves stale for minutes.
  const defaultSaison = selectSaison(saisons, undefined);

  return (
    <SaisonSelector
      saisons={saisons.map(asOption)}
      defaultSaison={defaultSaison === undefined ? null : asOption(defaultSaison)}
    />
  );
}
