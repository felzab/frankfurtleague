import { SpielPopup } from "@/kit/SpielHead";

import { ROUTES } from "@/core/routes";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { spielPopupOf } from "@/features/spiele/popup";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { SpielPopupContent } from "@/kit/SpielHead";

/**
 * A match opened from a match card: the pop-up over the season page it was opened on, the address the match
 * page's own. Back closes it and leaves the page as it was.
 */
export default function SpielPopupPage({ params }: PageProps<"/saisons/[saison]/spiele/[spiel]">) {
  return <SpielPopup popup={readPopup(params)} />;
}

async function readPopup(params: Promise<{ saison: string; spiel: string }>): Promise<SpielPopupContent> {
  const spielId = await resolveObjectIdParam(params, "spiel");
  const saison = await resolvePublicSaisonParam(params);
  return spielPopupOf(saison, spielId, ROUTES.spielplan.path(saison));
}
