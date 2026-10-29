import { Suspense } from "react";

import { ReadPage } from "@/kit/ReadPage";

import { ROUTES } from "@/core/routes";
import { pageMetadata } from "@/shared/utils/metadata";

import { factsOf, readSaison, readSpiel, sidesOf } from "../../spielplan";

import type { Metadata } from "next";

export async function generateMetadata({ params }: PageProps<"/saisons/[saison]/spiele/[spiel]">): Promise<Metadata> {
  const { saison: saisonId, spiel: spielId } = await params;
  const { saison } = await readSaison(saisonId);
  const { spiel } = await readSpiel(saison, spielId);
  const { heim, gast } = sidesOf(spiel);
  return pageMetadata(ROUTES.spiel, ROUTES.spiel.pfad(saison.id, spiel.id), ROUTES.spiel.titel(heim.name, gast.name));
}

/**
 * A match's own page, on a direct load or a reload. Opened from a match row, the same body shows as the
 * pop-up over the Spielplan instead (`@modal/(.)spiele/[spiel]`).
 */
export default function SpielPage({ params }: PageProps<"/saisons/[saison]/spiele/[spiel]">) {
  return (
    <Suspense fallback={null}>
      <Spiel params={params} />
    </Suspense>
  );
}

async function Spiel({ params }: { params: Promise<{ saison: string; spiel: string }> }) {
  const { saison: saisonId, spiel: spielId } = await params;
  const { saison } = await readSaison(saisonId);
  const { spiel, spieltag } = await readSpiel(saison, spielId);
  const { heim, gast } = sidesOf(spiel);
  return (
    <ReadPage
      head={{ area: "saison", title: { route: "spiel", heim: heim.name, gast: gast.name } }}
      groups={[{ kind: "facts", facts: factsOf(spiel, spieltag) }]}
    />
  );
}
