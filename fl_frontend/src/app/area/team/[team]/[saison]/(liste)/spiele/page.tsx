import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { readAsSeatHolder, requireTeamSeats, teamSeatsAt } from "@/features/roles/resolvers";
import { matchdayOf, matchRowOf, whenOf } from "@/features/spiele/blocks";
import { getTeamSpiele } from "@/features/spiele/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { FLTeamPanelSpiel } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/team/[team]/[saison]/spiele">;

/** The page's own address, which a session sent to sign in comes back to. */
const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamSpiele.path(team, saison);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(teamSeatsAt(params, address), async () => pageMetadata(parent, ROUTES.teamSpiele, address(await params)));
}

/** The states of a date the league asked the club about that still wait on the club's own answer. */
const UNANSWERED: ReadonlySet<FLTeamPanelSpiel["termin"]> = new Set(["valid", "vorschlag", "expired"]);

/**
 * The one thing a match still needs from the club, its row's one chip: an answer to its date first, then its line-up,
 * missing until the day it is due and overdue from then, in the danger hue; nothing once the line-up is stored or locked,
 * since a match with no chip needs nothing from the club.
 */
function openOn({ termin, aufstellung }: FLTeamPanelSpiel): ChipProps | undefined {
  const { missing } = SERVER_COPY.overview;
  if (UNANSWERED.has(termin)) return { tone: "warn", label: missing(COPY.area.answer) };
  if (aufstellung === null || aufstellung.stored) return undefined;
  if (aufstellung.phase === "open") return { tone: "warn", label: missing(SERVER_COPY.season.spiel.aufstellung) };
  if (aufstellung.phase === "overdue") return { tone: "danger", label: COPY.area.team.aufstellung.overdueOnCard };
  return undefined;
}

/**
 * Each match under its matchday's head, the whole row leading to its line-up's page. What befell a match is its chip,
 * as every list shows it; else what the match still needs from the club.
 */
async function readSpiele(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const { spiele } = await readAsSeatHolder(() => getTeamSpiele(seat.team_id, seat.saison_id));
  return {
    groups: spiele.map((spiel) => {
      const row = matchRowOf(spiel);
      const chip = row.chip ?? openOn(spiel);
      return {
        head: matchdayOf(spiel, spiel),
        spiel: {
          ...row,
          href: ROUTES.teamAufstellung.path(seat.team_id, seat.saison_id, spiel.id),
          // The head names the matchday, the third-place match included, so the date line names the day alone.
          when: whenOf(spiel),
          ...(chip === undefined ? {} : { chip }),
        },
      };
    }),
    empty: { kind: "none", plural: COPY.page.spiele } as const,
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
