import { Link } from "@/kit/Link";
import { SpielPopup } from "@/kit/SpielHead";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { ereignisOf, headOf, popupFactsOf, readSaison, readSpiel, sidesOf } from "../../../spielplan";

import type { SpielPopupContent } from "@/kit/SpielHead";

/**
 * A match opened from a match row: the pop-up over the Spielplan, the address the match page's own. Back
 * closes it and leaves the Spielplan on the matchday it showed.
 */
export default function SpielPopupPage({ params }: { params: Promise<{ saison: string; spiel: string }> }) {
  return <SpielPopup popup={readPopup(params)} />;
}

function readPopup(params: Promise<{ saison: string; spiel: string }>): Promise<SpielPopupContent> {
  return params.then(async ({ saison: saisonId, spiel: spielId }) => {
    const { saison } = await readSaison(saisonId);
    const { spiel, spieltag } = await readSpiel(saison, spielId);
    const { heim, gast } = sidesOf(spiel);
    return {
      title: ROUTES.spiel.title(heim.name, gast.name),
      beneath: ROUTES.spielplan.path(saison.id),
      act: (
        // A full page load: a client navigation to this same address is intercepted again as this pop-up.
        <Link
          href={ROUTES.spiel.path(saison.id, spiel.id)}
          placement="button"
          fullPage
          label={COPY.shared.toSpiel}
        />
      ),
      head: headOf(spiel, spieltag),
      facts: popupFactsOf(spiel),
      sonderereignis: ereignisOf(spiel),
    };
  });
}
