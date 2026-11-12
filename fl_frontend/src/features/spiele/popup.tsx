import { notFound } from "next/navigation";

import { Link } from "@/kit/Link";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getSpielPage } from "@/features/saisons/queries";

import { eventOf, headOf, popupFactsOf, sidesOf } from "./blocks";

import type { SpielPopupContent } from "@/kit/SpielHead";

/** The ids arrive parsed by the caller. */
export async function spielPopupOf(saison: string, spielId: string): Promise<SpielPopupContent> {
  const page = await getSpielPage(saison, spielId);
  if (page === null) notFound();
  const { spiel, standings } = page;
  const { team1, team2 } = sidesOf(spiel);
  return {
    title: ROUTES.spiel.title(team1.name, team2.name),
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
    head: headOf(spiel, page, standings),
    facts: popupFactsOf(spiel),
    sonderereignis: eventOf(spiel),
  };
}
