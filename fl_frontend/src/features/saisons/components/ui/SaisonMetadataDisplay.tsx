import { connection } from "next/server";

import { getAdminSaisons, getCurrentSaisonOrNull, getSaisons } from "../../queries";
import { selectSaison } from "../../resolvers";
import { SaisonSelector } from "./SaisonSelector";

import type { FLSaison } from "../../schemas";
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

  // The admin branch carries no guard of its own, so a caller placing it outside `AdminAuthGuard`
  // serves the planned seasons to whoever drew the render -- `fl_frontend/src/app/bereich/admin/layout.tsx`
  // places it under one.
  if (tier === "admin") {
    const { saisons } = await getAdminSaisons();
    // The pages' own default off the list they read in this request, never the cached current season,
    // which a write outside the app leaves stale for days (`docs/frontend/spec.md :: I359`).
    const defaultSaison = selectSaison(saisons, undefined);

    return (
      <SaisonSelector
        saisons={saisons.map(asOption)}
        defaultSaison={defaultSaison === undefined ? null : asOption(defaultSaison)}
      />
    );
  }

  const [currentSaisonRes, saisonsRes] = await Promise.all([
    // `OrNull`, never the throwing read: this is layout chrome, so a 404 between seasons would
    // take every dashboard page down with it.
    getCurrentSaisonOrNull(),
    getSaisons(),
  ]);

  return (
    <SaisonSelector
      saisons={saisonsRes.saisons.map(asOption)}
      defaultSaison={currentSaisonRes === null ? null : asOption(currentSaisonRes.saison)}
    />
  );
}
