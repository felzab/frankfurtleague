import { SpielPopup } from "@/kit/SpielHead";

import { ROUTES } from "@/core/routes";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { spielPopupOf } from "@/features/spiele/popup";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { SpielPopupContent } from "@/kit/SpielHead";

/**
 * A match opened from a match row on the landing: the same pop-up the season pages open, over the landing. The
 * route group is no segment, so `(.)` matches `saisons` from the landing's own level, the root.
 */
export default function LandingSpielPopupPage({ params }: PageProps<"/saisons/[saison]/spiele/[spiel]">) {
  return <SpielPopup popup={readPopup(params)} />;
}

async function readPopup(params: Promise<{ saison: string; spiel: string }>): Promise<SpielPopupContent> {
  const spielId = await resolveObjectIdParam(params, "spiel");
  const saison = await resolvePublicSaisonParam(params);
  return spielPopupOf(saison, spielId, ROUTES.home.path());
}
