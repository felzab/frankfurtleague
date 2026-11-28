import { notFound } from "next/navigation";

import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";
import { dayOf, formatDate, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { getSpielplan } from "@/features/saisons/queries";
import { publicSaisonOf, resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { matchRowOf, sidesOf, whenOf } from "@/features/spiele/blocks";
import { byKickOff, spieltagNamer } from "@/features/spieltage/utils";
import { ListPage } from "@/kit/ListPage";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { Copy } from "@/core/copy";
import type { FLSpielJoined } from "@/core/generated/client/types";
import type { Metadata } from "next";

type Props = PageProps<"/saisons/[saison]/search">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(publicSaisonOf(params), (saison) => pageMetadata(ROUTES.spielSearch, ROUTES.spielSearch.path(saison)));
}

/** The season's matches, each matchday's by kick-off, each with its matchday's name as the Spielplan's tab names it. */
async function readMatches(params: Props["params"]) {
  const spielplan = await getSpielplan(await resolvePublicSaisonParam(params));
  if (spielplan === null) notFound();
  const { spieltage } = spielplan;
  const nameOf = spieltagNamer(spieltage);
  return spieltage.flatMap((spieltag) => spieltag.spiele.toSorted(byKickOff).map((spiel) => ({ spiel, spieltag: nameOf(spieltag) })));
}

/**
 * What the typed text finds a match by: both clubs, or the sources of sides not yet known; its phase and its matchday's
 * name; its venue; its date as its card shows it and as a reader writes it; its number; its referee where the name is
 * public.
 */
function wordsOf(spiel: FLSpielJoined, spieltag: Copy): string {
  const { team1, team2 } = sidesOf(spiel);
  return [
    textOf(team1.name),
    textOf(team2.name),
    textOf(COPY.shared.phase[spiel.saison_phase]),
    textOf(spieltag),
    spiel.spielort?.name,
    whenOf(spiel),
    spiel.date === null ? null : formatDate(dayOf(spiel.date)),
    formatNumber(spiel.spiel_nr),
    spiel.schiedsrichter?.name,
  ]
    .filter((word) => word != null)
    .join(" ");
}

/**
 * The Spielsuche: the season's matches as the Spielplan's cards, narrowed by the text typed into its search field,
 * which stays on the page.
 */
export default function SpielSearchPage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "saison", title: { route: "spielSearch" } }}
      list={{
        kind: "spiele",
        search: { label: COPY.shared.search(COPY.page.spiele) },
        content: readMatches(params).then((matches) => ({
          matches: matches.map(({ spiel, spieltag }) => ({ row: matchRowOf(spiel), words: wordsOf(spiel, spieltag) })),
          empty: { kind: "none", plural: COPY.page.spiele, glyph: "search" },
        })),
      }}
    />
  );
}
