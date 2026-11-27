import { cache } from "react";
import { notFound } from "next/navigation";

import { boxRulesOf } from "@/core/action";
import { COPY } from "@/core/copy/shared";
import { ContractBreakError } from "@/core/errors";
import { dayIn, dayOf, timeOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { AUFSTELLUNG_CHIP } from "@/features/aufstellungen/constants";
import { LINEUP_WORDS, playersOf } from "@/features/aufstellungen/players";
import { getAufstellungSelf } from "@/features/aufstellungen/queries";
import { readAsSeatHolder, requireTeamSeats, teamMetadata } from "@/features/roles/resolvers";
import { eventChipOf, matchdayOf, matchName } from "@/features/spiele/blocks";
import { StatusPage } from "@/kit/StatusPage";
import { pageMetadata } from "@/shared/utils/metadata";
import { objectIdParamOf } from "@/shared/utils/routeParams";

import { saveAufstellung } from "./saveAufstellung";
import { TeamAufstellung } from "./TeamAufstellung";

import type { Copy } from "@/core/copy";
import type { FLAufstellungResponse } from "@/core/generated/client/types";
import type { ChipProps } from "@/kit/Chip";
import type { Metadata } from "next";

type Props = PageProps<"/area/team/[team]/[saison]/spiele/[spiel]">;

const address = ({ team, saison, spiel }: { team: string; saison: string; spiel: string }) => ROUTES.teamAufstellung.path(team, saison, spiel);

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

/** The line-up's title, its tab's and its strip's: the club whose line-up it is, as the administration's twin reads. */
function titleOf({ spiel, team_id }: FLAufstellungResponse): Copy {
  const team = [spiel.team1, spiel.team2].find((side) => side?.team_id === team_id);
  if (team === undefined || team === null) throw new ContractBreakError("A line-up's read named a club its fixture does not field.");
  return ROUTES.teamAufstellung.title({ record: team.name });
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return teamMetadata(
    params,
    address,
    (seat) => lineupAt(params, seat.team_id, seat.saison_id),
    async (found) => pageMetadata(ROUTES.teamAufstellung, address(await params), { title: titleOf(found) }),
  );
}

/**
 * The line under the title: the match, since the title names one club, the matchday, as the Spiele list names it, and
 * when the match is played; and where nothing is stored before the lock, the day the line-up is due, or since when it is
 * overdue, unless something befell the match, which then needs no line-up from the club. Due and overdue refuse
 * nothing: they are words alone. From the lock, the closed editor's reason says the league alone changes it.
 */
function leadOf({ spiel, marks }: FLAufstellungResponse): Copy {
  const when = COPY.spielplan.when(dayOf(spiel.date), timeOf(spiel.time));
  const words = COPY.aufstellung;
  const due =
    marks === null || marks.stored || marks.phase === "locked" || spiel.sonderereignis !== null ? null : dayIn(new Date(marks.due_at));
  const owed = due === null ? null : marks?.phase === "overdue" ? words.overdueSince(due) : words.dueBy(due);
  return COPY.shared.line([matchName(spiel.team1?.name ?? null, spiel.team2?.name ?? null), matchdayOf(spiel, spiel), when, owed]);
}

/**
 * The chip after the title, the line-up's own state: what befell the match, as every match block draws it; else
 * „Gesperrt“ from the lock, the closed editor's reason saying who enters it now; else „Überfällig“ while nothing is
 * stored past the due mark.
 */
function chipOf({ spiel, marks }: FLAufstellungResponse): ChipProps | undefined {
  if (spiel.sonderereignis !== null) return eventChipOf(spiel.sonderereignis, spiel.team1?.name ?? null, spiel.team2?.name ?? null);
  if (marks === null || (marks.stored && marks.phase !== "locked")) return undefined;
  return AUFSTELLUNG_CHIP[marks.phase];
}

/**
 * A match's line-up as its club's seats enter it, on one read of the fixture, the squad and the stored line-up: the
 * editor until one hour before kick-off, and from then the same editor closed, as the administration opens a record it
 * may no longer change, since the league alone changes the line-up now. A match with no day or hour takes no line-up,
 * so the page says what of its slot is still open, its date or, beside its day as the Spielplan words it, its hour, and
 * leads to the team's Übersicht.
 */
export default async function AufstellungPage({ params }: Props) {
  const [seat] = await requireTeamSeats(params, address);
  const found = await readAsSeatHolder(() => lineupAt(params, seat.team_id, seat.saison_id));
  if (found === null) notFound();

  const title = titleOf(found);
  if (found.marks === null) {
    const day = dayOf(found.spiel.date);
    return (
      <StatusPage
        scope="area"
        title={title}
        card={{
          tone: "info",
          // A match without marks has no kick-off: undated, its date is open; dated, its hour is.
          title: day === null ? COPY.spielplan.when(null, null) : SERVER_COPY.season.spiel.timeOpen(COPY.spielplan.when(day, null)),
          next: { label: COPY.shared.end.toOverview, href: ROUTES.teamOverview.path(seat.team_id, seat.saison_id) },
        }}
      />
    );
  }
  const closed = found.marks.phase === "locked" ? COPY.aufstellung.lockedLine : undefined;
  const chip = chipOf(found);
  return (
    <TeamAufstellung
      rules={boxRulesOf(saveAufstellung)}
      team={seat.team_id}
      title={title}
      {...(chip === undefined ? {} : { chip })}
      lead={leadOf(found)}
      aufstellung={{ id: found.spiel.spiel_id, version: found.version, spieler: found.spieler }}
      players={playersOf(found)}
      words={LINEUP_WORDS}
      // The league still changes a locked line-up, so its acts stay drawn and locked, the lock line saying why.
      {...(closed === undefined ? {} : { closed, acts: "locked" })}
    />
  );
}
