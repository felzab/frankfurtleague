import { connection } from "next/server";

import { getAdminSaisons, getCurrentSaison, getSaisons } from "../../queries";
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
  // The admin branch is guarded by `proxy.ts` alone: the shell's chrome is the layout's, rendered
  // beside `AdminAuthGuard` rather than under it, which every other admin-tier read sits inside.
  const [currentSaisonRes, saisonsRes] = await Promise.all([getCurrentSaison(), tier === "admin" ? getAdminSaisons() : getSaisons()]);

  return (
    <SaisonSelector
      saisons={saisonsRes.saisons.map(asOption)}
      currentSaison={asOption(currentSaisonRes.saison)}
    />
  );
}
