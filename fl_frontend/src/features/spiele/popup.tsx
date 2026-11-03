import { notFound } from "next/navigation";

import { Link } from "@/kit/Link";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getSpielPage } from "@/features/saisons/queries";

import { ereignisOf, headOf, popupFactsOf, sidesOf } from "./blocks";

import type { SpielPopupContent } from "@/kit/SpielHead";
import type { Route } from "next";

/**
 * The match pop-up's body, which every `@modal` slot showing match rows renders: the season area's and the landing's.
 * They differ in `beneath` alone, the page the pop-up opens over. The ids are the caller's, parsed already.
 */
export async function spielPopupOf(saison: string, spielId: string, beneath: Route): Promise<SpielPopupContent> {
  const page = await getSpielPage(saison, spielId);
  if (page === null) notFound();
  const { spiel, spieltag_position: position, standings } = page;
  const { heim, gast } = sidesOf(spiel);
  return {
    title: ROUTES.spiel.title(heim.name, gast.name),
    beneath,
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
