import { cache } from "react";

import { ListPage } from "@/kit/ListPage";
import { EXPIRED_CHIP } from "@/kit/stateChips";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { AUFSTELLUNG_CHIP } from "@/features/aufstellungen/constants";
import { readAsSeatHolder, requireTeamSeats, teamMetadata } from "@/features/roles/resolvers";
import { headedMatchOf } from "@/features/spiele/blocks";
import { getTeamSpiele } from "@/features/spiele/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import type { FLTeamPanelSpiel } from "@/core/generated/client/types";
import type { TeamSeat } from "@/features/roles/resolvers";
import type { ChipProps } from "@/kit/Chip";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/team/[team]/[saison]/spiele">;

/** The page's own address, which a session sent to sign in comes back to. */
const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamSpiele.path(team, saison);

/** The page's one read, memoised for the render on its two ids, which `cache` compares by identity, so the tab's title and the page share it. */
const spieleRead = cache(getTeamSpiele);
const spieleOf = (seat: TeamSeat) => spieleRead(seat.team_id, seat.saison_id);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return teamMetadata(params, address, spieleOf, async () => pageMetadata(parent, ROUTES.teamSpiele, address(await params)));
}

/** The states of a date the league asked the club about that still wait on the club's own answer. */
const UNANSWERED: ReadonlySet<FLTeamPanelSpiel["spielbestaetigung"]> = new Set(["valid", "vorschlag"]);

/**
 * The one thing a match still needs from the club, its row's one chip: an answer to its date first, or that its date
 * lapsed unanswered, which no answer reaches now; then its line-up, missing until the day it is due and overdue from
 * then, in the danger hue; nothing once the line-up is stored or locked, since a match with no chip needs nothing from
 * the club.
 */
function openOn({ spielbestaetigung, aufstellung }: FLTeamPanelSpiel): ChipProps | undefined {
  const { missing } = SERVER_COPY.overview;
  if (UNANSWERED.has(spielbestaetigung)) return { tone: "warn", label: missing(COPY.area.answer) };
  if (spielbestaetigung === "expired") return EXPIRED_CHIP;
  if (aufstellung === null || aufstellung.stored) return undefined;
  if (aufstellung.phase === "open") return { tone: "warn", label: missing(SERVER_COPY.season.spiel.aufstellung) };
  if (aufstellung.phase === "overdue") return { ...AUFSTELLUNG_CHIP.overdue, label: COPY.area.team.aufstellung.overdueOnCard };
  return undefined;
}

/**
 * Each match under its matchday's head, the whole row leading to its line-up's page. What befell a match is its chip,
 * as every list shows it; else what the match still needs from the club.
 */
async function readSpiele(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const { spiele } = await readAsSeatHolder(() => spieleOf(seat));
  return {
    groups: spiele.map((spiel) => {
      const { head, spiel: row } = headedMatchOf(spiel);
      const chip = row.chip ?? openOn(spiel);
      return {
        head,
        spiel: {
          ...row,
          href: ROUTES.teamAufstellung.path(seat.team_id, seat.saison_id, spiel.id),
          ...(chip === undefined ? {} : { chip }),
        },
      };
    }),
    empty: { kind: "none", plural: COPY.page.spiele, glyph: "spielplan" } as const,
  };
}

/** A club's matches in one season, each with the one thing it still needs from the club. */
export default function TeamSpielePage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "teamSpiele" } }}
      list={{ kind: "spielGroups", wait: 2, content: readSpiele(params) }}
    />
  );
}
