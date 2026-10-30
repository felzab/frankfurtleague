import { connection } from "next/server";

import { getActiveSaisonOrNull, getAdminSaisons, getSaisons } from "../../queries";
import { selectSaison } from "../../resolvers";
import { SaisonSelector } from "./SaisonSelector";

import type { FLSaison } from "@/core/generated/client/types";
import type { SaisonSelectorOption } from "../../types";

/** Id and range only — the whole of what the switcher renders, and the whole of what may cross into it. */
const asOption = ({ id, start_date, end_date }: FLSaison): SaisonSelectorOption => ({ id, start_date, end_date });

/**
 * `tier` decides WHICH seasons the switcher offers. The admin shell must offer a planned one, which
 * `GET /saisons` withholds: a season is created planned, and that is the only window a club has to
 * be entered into it.
 */
export async function SaisonMetadataDisplay({ tier }: { tier: "base" | "admin" }) {
  await connection();

  // Only an admin render asks for the admin branch: its read sends a session that is no administrator's
  // to the sign-in landing (`fl_frontend/src/shared/utils/adminRead.ts :: runAdminRead`).
  if (tier === "admin") {
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

  const [activeSaisonRes, saisonsRes] = await Promise.all([
    // `OrNull`, never the throwing read: this is layout chrome, so a 404 between seasons would
    // take every dashboard page down with it.
    getActiveSaisonOrNull(),
    getSaisons(),
  ]);

  return (
    <SaisonSelector
      saisons={saisonsRes.saisons.map(asOption)}
      defaultSaison={activeSaisonRes === null ? null : asOption(activeSaisonRes.saison)}
    />
  );
}
