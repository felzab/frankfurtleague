import { Suspense } from "react";

import { RouteDialog } from "@/kit/Dialog";
import { Facts } from "@/kit/Facts";

import { ROUTES } from "@/core/routes";

import { factsOf, readSaison, readSpiel, sidesOf } from "../../../spielplan";

/**
 * A match opened from a match row: the match page's facts in the pop-up over the Spielplan, the address
 * the match page's own. Back closes it and leaves the Spielplan on the matchday it showed.
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
  return (
    <RouteDialog
      title={ROUTES.spiel.titel(heim.name, gast.name)}
      beneath={ROUTES.spielplan.pfad(saison.id)}>
      <Facts facts={factsOf(spiel, spieltag)} />
    </RouteDialog>
  );
}
