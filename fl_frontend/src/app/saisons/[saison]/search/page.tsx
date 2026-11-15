import { notFound } from "next/navigation";

import { filterValue } from "@/kit/filterValue";
import { ListPage } from "@/kit/ListPage";

import { COPY, textOf } from "@/core/copy";
import { dayOf, formatDate, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { getSpielplan } from "@/features/saisons/queries";
import { publicSaisonOf, resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { matchRowOf, sidesOf, whenOf } from "@/features/spiele/blocks";
import { spieltagNamer } from "@/features/spieltage/utils";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { Copy } from "@/core/copy";
import type { FLSpielJoined, FLSpielplanSpieltag } from "@/core/generated/client/types";
import type { Filter } from "@/kit/Filters";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/search">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(publicSaisonOf(params), (saison) => pageMetadata(parent, ROUTES.spielSearch, ROUTES.spielSearch.path(saison)));
}

/** A matchday as the address names it: its stored phase and position, as the Spielplan's tabs do. */
const keyOf = (spieltag: FLSpielplanSpieltag) => `${spieltag.saison_phase}-${String(spieltag.position)}`;

/** The season's matches with their matchday's key, and the three filters over them with the address's values. */
async function readSeason(params: Props["params"], searchParams: Props["searchParams"]) {
  const spielplan = await getSpielplan(await resolvePublicSaisonParam(params));
  if (spielplan === null) notFound();
  const address = await searchParams;
  const { spieltage } = spielplan;
  const matches = spieltage.flatMap((spieltag) => spieltag.spiele.map((spiel) => ({ spiel, spieltag: keyOf(spieltag) })));
  const nameOf = spieltagNamer(spieltage);
  const clubs = new Map(
    matches.flatMap(({ spiel }) => [spiel.team1, spiel.team2].flatMap((team) => (team === null ? [] : [[team.team_id, team.name] as const]))),
  );
  const words = SERVER_COPY.season.filter;
  const filter = (name: string, label: Copy, options: Filter["options"]): Filter => ({
    name,
    label,
    all: words.all,
    options,
    value: filterValue(address[name], options),
  });
  const filters = [
    filter(
      "phase",
      words.phase,
      SAISON_PHASE_OPTIONS.filter((phase) => spieltage.some((spieltag) => spieltag.saison_phase === phase)).map((phase) => ({
        id: phase,
        label: PHASE_LABELS[phase],
      })),
    ),
    filter(
      "team",
      words.team,
      [...clubs].sort(([, one], [, other]) => one.localeCompare(other, "de")).map(([id, name]) => ({ id, label: { record: name } })),
    ),
    filter(
      "spieltag",
      words.spieltag,
      spieltage.map((spieltag) => ({ id: keyOf(spieltag), label: nameOf(spieltag) })),
    ),
  ];
  return { matches, filters };
}

/** Whether a match passes the filters the address sets: its phase, one of its two clubs, its matchday. */
function passes(match: { spiel: FLSpielJoined; spieltag: string }, filters: readonly Filter[]): boolean {
  const [phase, team, spieltag] = filters.map((filter) => filter.value);
  const { spiel } = match;
  return (
    (phase == null || spiel.saison_phase === phase) &&
    (team == null || spiel.team1?.team_id === team || spiel.team2?.team_id === team) &&
    (spieltag == null || match.spieltag === spieltag)
  );
}

/**
 * What the typed text finds a match by: both clubs, or the sources of sides not yet known; its venue; its date as
 * its card shows it and as a reader writes it; its number; its referee where the name is public.
 */
function wordsOf(spiel: FLSpielJoined): string {
  const { team1, team2 } = sidesOf(spiel);
  return [
    textOf(team1.name),
    textOf(team2.name),
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
 * The Spielsuche: the season's matches as the Spielplan's cards, narrowed by phase, club and matchday, the
 * values in the address, and by the text typed into its search field, which stays on the page.
 */
export default function SpielSearchPage({ params, searchParams }: Props) {
  const season = readSeason(params, searchParams);
  return (
    <ListPage
      head={{ scope: "saison", title: { route: "spielSearch" } }}
      filters={season.then(({ filters }) => filters)}
      list={{
        kind: "spiele",
        search: { label: COPY.page.spielSearch },
        content: season.then(({ matches, filters }) => {
          const narrowed = filters.some((filter) => filter.value !== null);
          return {
            matches: matches.filter((match) => passes(match, filters)).map(({ spiel }) => ({ row: matchRowOf(spiel), words: wordsOf(spiel) })),
            empty: { kind: narrowed ? "filter" : "none", plural: COPY.page.spiele, glyph: "search" },
          };
        }),
      }}
    />
  );
}
