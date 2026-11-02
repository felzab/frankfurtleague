import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { formatDatum, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { PHASE_LABELS, SAISON_PHASE_OPTIONS } from "@/features/saisons/constants";
import { getSpielplan } from "@/features/saisons/queries";
import { matchRowOf, sidesOf, whenOf } from "@/features/spiele/blocks";
import { spieltagLabels } from "@/features/spieltage/utils";
import { pageMetadata } from "@/shared/utils/metadata";

import type { Copy } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type { FLSpielJoined, FLSpielplanSpieltag } from "@/core/generated/client/types";
import type { Filter } from "@/kit/Filters";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/search">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return pageMetadata(parent, ROUTES.spielSearch, ROUTES.spielSearch.path(saison));
}

/** A matchday as the address names it: its stored phase and position, as the Spielplan's tabs do. */
const keyOf = (spieltag: FLSpielplanSpieltag) => `${spieltag.saison_phase}-${String(spieltag.position)}`;

/** The season's matches with their matchday's key, and the three filters over them with the address's values. */
async function readSeason(params: Props["params"], searchParams: Props["searchParams"]) {
  const spielplan = await getSpielplan((await params).saison);
  if (spielplan === null) notFound();
  const address = await searchParams;
  const { spieltage } = spielplan;
  const matches = spieltage.flatMap((spieltag) => spieltag.spiele.map((spiel) => ({ spiel, spieltag: keyOf(spieltag) })));
  const labels = spieltagLabels(spieltage);
  const clubs = new Map(
    matches.flatMap(({ spiel }) => [spiel.team1, spiel.team2].flatMap((team) => (team === null ? [] : [[team.team_id, team.name] as const]))),
  );
  const words = SERVER_COPY.season.filter;
  const filter = (name: string, label: Copy, options: Filter["options"]): Filter => {
    const named = address[name];
    const value = Array.isArray(named) ? named[0] : named;
    return { name, label, all: words.all, options, value: options.some((option) => option.id === value) ? (value ?? null) : null };
  };
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
      [...clubs].map(([id, name]) => ({ id, label: name })).sort((one, other) => one.label.localeCompare(other.label, "de")),
    ),
    filter(
      "spieltag",
      words.spieltag,
      spieltage.map((spieltag) => ({ id: keyOf(spieltag), label: labels.get(spieltag.id)?.label ?? "" })),
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
  const { heim, gast } = sidesOf(spiel);
  return [
    heim.name,
    gast.name,
    spiel.ort?.name,
    whenOf(spiel),
    spiel.datum === null ? null : formatDatum(spiel.datum as CalendarDay),
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
export default function SpielsuchePage({ params, searchParams }: Props) {
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
