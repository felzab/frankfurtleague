import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";
import { LineupPlaceholder } from "@/kit/Lineup";

import { COPY } from "@/core/copy";
import { ContractBreakError } from "@/core/errors";
import { dayOf, timeOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { STARTERS_MAX } from "@/features/aufstellungen/constants";
import { LINEUP_WORDS, playersOf } from "@/features/aufstellungen/players";
import { getAufstellung } from "@/features/aufstellungen/queries";
import { matchdayOf, matchName, matchTitle } from "@/features/spiele/blocks";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { AdminAufstellung } from "./AdminAufstellung";

import type { Copy } from "@/core/copy";
import type { FLAufstellungResponse } from "@/core/generated/client/types";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/spiele/[spiel]/aufstellung/[team]">;

/** One read of the line-up for the tab's title and the page alike. */
const read = cache(getAufstellung);

/**
 * The line-up the address names, as every season page reads its record: `null` for a malformed match or club id, for a
 * match that does not field the club, and for one of another season, each of which the page says is not found.
 */
async function findAufstellung(params: Props["params"]): Promise<FLAufstellungResponse | null> {
  const spiel = await adminIdParamOf(params, "spiel");
  const team = await adminIdParamOf(params, "team");
  const { saison } = await params;
  const found = spiel === null || team === null ? null : await read(spiel, team);
  return found === null || found.spiel.saison_id !== saison ? null : found;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(findAufstellung(params), ({ spiel, team_id }) =>
    pageMetadata(parent, ROUTES.adminAufstellung, ROUTES.adminAufstellung.path(spiel.saison_id, spiel.spiel_id, team_id), {
      title: matchName(spiel.team1?.name ?? null, spiel.team2?.name ?? null),
    }),
  );
}

/**
 * The line under the title: whose line-up it is, since the title names both clubs, the matchday as the Spiele list
 * names it, and when the match is played. No due day: the league enters a line-up whenever the match has its slot.
 */
function leadOf({ spiel, team_id }: FLAufstellungResponse): Copy {
  const club = [spiel.team1, spiel.team2].find((side) => side?.team_id === team_id);
  if (club === undefined || club === null) throw new ContractBreakError("A line-up's read named a club its fixture does not field.");
  return COPY.shared.line([
    COPY.area.team.aufstellung.ofTeam({ record: club.name }),
    matchdayOf(spiel, spiel),
    COPY.spielplan.when(dayOf(spiel.date), timeOf(spiel.time)),
  ]);
}

/**
 * The page once read: the editor, open before the team's lock and after it alike, since the clock locks nothing for the
 * league. A match with no day or hour takes no line-up, so its editor opens with nobody to name. A finished season's
 * line-ups take no write (`saison_past`), so the editor opens on one read-only, as the match editor does.
 */
async function readEditor(params: Props["params"]) {
  const found = await findAufstellung(params);
  if (found === null) notFound();

  const closed = found.saison_status === "past" ? SERVER_COPY.refusalLine.saison_past : undefined;
  // The block's every act answers a press with why it is closed: the season's end before the missing slot.
  const locked = closed ?? (found.marks === null ? COPY.area.team.aufstellung.needsSlot : undefined);
  return (
    <AdminAufstellung
      team={found.team_id}
      title={matchTitle(found.spiel.team1?.name ?? null, found.spiel.team2?.name ?? null)}
      lead={leadOf(found)}
      aufstellung={{ id: found.spiel.spiel_id, version: found.version, spieler: found.spieler }}
      players={playersOf(found)}
      words={LINEUP_WORDS}
      {...(locked === undefined ? {} : { locked })}
      {...(closed === undefined ? {} : { closed })}
    />
  );
}

/** One club's line-up for a match as the league enters it, on one read of the fixture, the squad and the stored line-up. */
export default function AdminAufstellungPage({ params }: Props) {
  return (
    <EditorShell
      wait={{
        lead: true,
        // A typical line-up: eleven named over the squad's nine others, as a club that has entered one opens it.
        sections: [
          {
            block: (
              <LineupPlaceholder
                words={LINEUP_WORDS}
                picked={STARTERS_MAX}
                rest={9}
              />
            ),
          },
        ],
      }}
      editor={readEditor(params)}
    />
  );
}
