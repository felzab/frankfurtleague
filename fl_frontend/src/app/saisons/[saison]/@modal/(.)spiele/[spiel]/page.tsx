import { Suspense } from "react";

import { Callout } from "@/kit/Callout";
import { RouteDialog } from "@/kit/Dialog";
import { Facts } from "@/kit/Facts";
import { Link } from "@/kit/Link";
import { SpielHead } from "@/kit/MatchHead";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";

import { ereignisOf, headOf, popupFactsOf, readSaison, readSpiel, sidesOf } from "../../../spielplan";

/**
 * A match opened from a match row: the pop-up over the Spielplan, the address the match page's own. The
 * matchday and the pairing on the band across its top, the facts under them, what befell the match where
 * something did, and the way to the match's page as the dialog's act. Back closes it and leaves the
 * Spielplan on the matchday it showed.
 */
export default function SpielPopup({ params }: { params: Promise<{ saison: string; spiel: string }> }) {
  return (
    <Suspense fallback={null}>
      <Popup params={params} />
    </Suspense>
  );
}

async function Popup({ params }: { params: Promise<{ saison: string; spiel: string }> }) {
  const { saison: saisonId, spiel: spielId } = await params;
  const { saison } = await readSaison(saisonId);
  const { spiel, spieltag } = await readSpiel(saison, spielId);
  const { heim, gast } = sidesOf(spiel);
  const facts = popupFactsOf(spiel);
  const ereignis = ereignisOf(spiel);
  return (
    <RouteDialog
      title={ROUTES.spiel.titel(heim.name, gast.name)}
      beneath={ROUTES.spielplan.path(saison.id)}
      act={
        // A full page load: a client navigation to this same address is intercepted again as this pop-up.
        <Link
          href={ROUTES.spiel.path(saison.id, spiel.id)}
          placement="button"
          fullPage
          label={COPY.shared.zumSpiel}
        />
      }>
      <SpielHead {...headOf(spiel, spieltag)} />
      {facts.length > 0 && (
        <Facts
          look="free"
          facts={facts}
        />
      )}
      {ereignis !== null && (
        <Callout
          tone="danger"
          title={ereignis.title}
          text={ereignis.text}
        />
      )}
    </RouteDialog>
  );
}
