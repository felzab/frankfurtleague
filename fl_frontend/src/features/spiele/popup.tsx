import { notFound } from "next/navigation";

import { Link } from "@/kit/Link";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getSpielPage } from "@/features/saisons/queries";

import { ereignisOf, headOf, popupFactsOf, sidesOf } from "./blocks";

import type { SpielPopupContent } from "@/kit/SpielHead";

/**
 * The match pop-up's body, which the root layout's `@modal` slot renders over the page a match row was pressed on.
 * The slot serves every page, so the page beneath is not known here: where the tab holds nothing to go back to,
 * closing leads to the match's Spielplan, where its season lists it. The ids are the caller's, parsed already.
 */
export async function spielPopupOf(saison: string, spielId: string): Promise<SpielPopupContent> {
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
