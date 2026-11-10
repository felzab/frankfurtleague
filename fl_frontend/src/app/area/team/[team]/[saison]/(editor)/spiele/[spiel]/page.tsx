import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";
import { LineupPlaceholder } from "@/kit/Lineup";

import { COPY } from "@/core/copy";
import { dayIn, dayOf, timeOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { STARTERS_MAX } from "@/features/aufstellungen/constants";
import { LINEUP_WORDS, playersOf } from "@/features/aufstellungen/players";
import { getAufstellungSelf } from "@/features/aufstellungen/queries";
import { readAsSeatHolder, requireTeamSeats, teamMetadata } from "@/features/roles/resolvers";
import { matchdayOf, matchName, matchTitle } from "@/features/spiele/blocks";
import { pageMetadata } from "@/shared/utils/metadata";
import { objectIdParamOf } from "@/shared/utils/routeParams";

import { TeamAufstellung } from "./TeamAufstellung";

import type { Copy } from "@/core/copy";
import type { FLAufstellungResponse } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/team/[team]/[saison]/spiele/[spiel]">;

/** The page's own address, which a session sent to sign in comes back to. */
const address = ({ team, saison, spiel }: { team: string; saison: string; spiel: string }) => ROUTES.teamAufstellung.path(team, saison, spiel);

/** One read of the line-up for the tab's title and the page alike. */
const read = cache(getAufstellungSelf);

/**
 * The line-up the address names, for a seat held at its team and season: `null` for a malformed match id, for a match
 * that does not field the club, and for one of another season, each of which the page says is not found.
 */
async function lineupAt(params: Props["params"], team: string, saison: string): Promise<FLAufstellungResponse | null> {
  const spiel = await objectIdParamOf(params, "spiel");
  const found = spiel === null ? null : await read(spiel, team);
  return found === null || found.spiel.saison_id !== saison ? null : found;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return teamMetadata(
    params,
    address,
    (seat) => lineupAt(params, seat.team_id, seat.saison_id),
    async ({ spiel }) =>
      pageMetadata(parent, ROUTES.teamAufstellung, address(await params), {
        title: matchName(spiel.team1?.name ?? null, spiel.team2?.name ?? null),
      }),
  );
}

/**
 * The line under the title: the matchday, as the Spiele list names it, and when the match is played; and where nothing
 * is stored before the lock, the day the line-up is due, or since when it is overdue. Due and overdue refuse nothing:
 * they are words alone. From the lock, the closed editor's reason says the league alone changes it.
 */
function leadOf({ spiel, marks }: FLAufstellungResponse): Copy {
  const when = COPY.spielplan.when(dayOf(spiel.date), timeOf(spiel.time));
  const words = COPY.area.team.aufstellung;
  const due = marks === null || marks.stored || marks.phase === "locked" ? null : dayIn(new Date(marks.due_at));
  const owed = due === null ? null : marks?.phase === "overdue" ? words.overdueSince(due) : words.dueBy(due);
  return SERVER_COPY.area.line([matchdayOf(spiel, spiel), when, owed]);
}

/** The chip after the title while nothing is stored past the due mark. */
const overdueChip = ({ marks }: FLAufstellungResponse): ChipProps | undefined =>
  marks !== null && !marks.stored && marks.phase === "overdue" ? { tone: "danger", label: COPY.area.team.aufstellung.overdue } : undefined;

/**
 * The page once read: the editor until one hour before kick-off, and from then the same editor closed, as the
 * administration opens a record it may no longer change, since the league alone changes the line-up now. A match with
 * no day or hour takes no line-up, so its editor opens with nobody to name.
 */
async function readEditor(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const found = await readAsSeatHolder(() => lineupAt(params, seat.team_id, seat.saison_id));
  if (found === null) notFound();

  const words = COPY.area.team.aufstellung;
  const closed = found.marks?.phase === "locked" ? words.lockedLine : undefined;
  // The block's every act answers a press with why it is closed: the lock before the missing slot.
  const locked = closed ?? (found.marks === null ? words.needsSlot : undefined);
  const chip = overdueChip(found);
  return (
    <TeamAufstellung
      team={seat.team_id}
      saison={seat.saison_id}
      title={matchTitle(found.spiel.team1?.name ?? null, found.spiel.team2?.name ?? null)}
      {...(chip === undefined ? {} : { chip })}
      lead={leadOf(found)}
      aufstellung={{ id: found.spiel.spiel_id, version: found.version, spieler: found.spieler, erased: found.erased }}
      players={playersOf(found)}
      words={LINEUP_WORDS}
      {...(locked === undefined ? {} : { locked })}
      {...(closed === undefined ? {} : { closed })}
    />
  );
}

/** A match's line-up as its club's seats enter it, on one read of the fixture, the squad and the stored line-up. */
export default function AufstellungPage({ params }: Props) {
  return (
    <EditorShell
      wait={{
        lead: true,
        // The line-up the board drew: eleven named over the squad's nine others, as a club that has entered one opens it.
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
