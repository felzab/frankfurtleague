import { SpielPopup } from "@/kit/SpielHead";

import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { spielPopupOf } from "@/features/spiele/popup";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import type { SpielPopupContent } from "@/kit/SpielHead";

/**
 * A match opened from a match row, on the landing or a season page: the pop-up over the page it was pressed on,
 * at the match page's own address. Back closes it and leaves the page as it was.
 *
 * The one interceptor of that address, and the root layout's. The landing stands at the root, and Next matches a
 * root-level interceptor from every address the site holds, a route group being no segment; placed in a frame's
 * own layout, it would also catch a press on a season page and put that frame's layout in place of the page
 * beneath, which Next then hides. In the root layout's slot, a client navigation keeps every page beneath it.
 */
export default function SpielPopupPage({ params }: PageProps<"/saisons/[saison]/spiele/[spiel]">) {
  return <SpielPopup popup={readPopup(params)} />;
}

async function readPopup(params: Promise<{ saison: string; spiel: string }>): Promise<SpielPopupContent> {
  const spielId = await resolveObjectIdParam(params, "spiel");
  const saison = await resolvePublicSaisonParam(params);
  return spielPopupOf(saison, spielId);
}
