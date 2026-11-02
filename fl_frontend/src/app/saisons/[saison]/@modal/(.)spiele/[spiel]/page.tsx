import { notFound } from "next/navigation";

import { Link } from "@/kit/Link";
import { SpielPopup } from "@/kit/SpielHead";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getSpielPage } from "@/features/saisons/queries";
import { ereignisOf, headOf, popupFactsOf, sidesOf } from "@/features/spiele/blocks";

import type { SpielPopupContent } from "@/kit/SpielHead";

/**
 * A match opened from a match card: the pop-up over the season page it was opened on, the address the match
 * page's own. Back closes it and leaves the page as it was.
 */
export default function SpielPopupPage({ params }: PageProps<"/saisons/[saison]/spiele/[spiel]">) {
  return <SpielPopup popup={readPopup(params)} />;
}

async function readPopup(params: Promise<{ saison: string; spiel: string }>): Promise<SpielPopupContent> {
  const { saison, spiel: spielId } = await params;
  const page = await getSpielPage(saison, spielId);
  if (page === null) notFound();
  const { spiel, spieltag_position: position, standings } = page;
  const { heim, gast } = sidesOf(spiel);
  return {
    title: ROUTES.spiel.title(heim.name, gast.name),
    beneath: ROUTES.spielplan.path(saison),
    act: (
      // A full page load: a client navigation to this same address is intercepted again as this pop-up.
      <Link
        href={ROUTES.spiel.path(saison, spiel.id)}
        placement="button"
        look="primary"
        fullPage
        label={COPY.shared.toSpiel}
      />
    ),
    head: headOf(spiel, position, standings),
    facts: popupFactsOf(spiel),
    sonderereignis: ereignisOf(spiel),
  };
}
