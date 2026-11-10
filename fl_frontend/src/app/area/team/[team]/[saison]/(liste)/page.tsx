import { cache } from "react";

import { ListPage } from "@/kit/ListPage";

import { now } from "@/core/clock";
import { COPY } from "@/core/copy";
import { dayIn, dayOf, timeOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { readAsSeatHolder, requireTeamSeats, teamMetadata } from "@/features/roles/resolvers";
import { matchName } from "@/features/spiele/blocks";
import { getTeamOverview } from "@/features/teams/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import { AgreeAct } from "./AgreeAct";
import { DeclineDialog } from "./DeclineDialog";

import type { Copy, Words } from "@/core/copy";
import type { CalendarDay } from "@/core/format";
import type {
  FLSpielbestaetigungAppointment,
  FLSpielbestaetigungViewAnsetzung,
  FLTeamPanelAufstellung,
  FLTeamPanelRegistrierung,
  FLTeamPanelTermin,
  FLTeamSeat,
} from "@/core/generated/client/types";
import type { TeamSeat } from "@/features/roles/resolvers";
import type { CardActRowProps } from "@/kit/Card";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/team/[team]/[saison]">;

type Row = CardActRowProps & { id: string };

const WORDS = SERVER_COPY.overview;
const TEAM = COPY.area.team;
const line = SERVER_COPY.area.line;

const TITLES = {
  termine: WORDS.card.dates,
  aufstellungen: TEAM.aufstellung.plural,
  registrierungen: COPY.page.registrierungen,
  seats: COPY.team.kontakte,
} as const;

/** The page's own address, which a session sent to sign in comes back to. */
const address = ({ team, saison }: { team: string; saison: string }) => ROUTES.teamOverview.path(team, saison);

/** The page's one read, memoised for the render, so the tab's title and the page share it. */
const overviewOf = cache((seat: TeamSeat) => getTeamOverview(seat.team_id, seat.saison_id));

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return teamMetadata(params, address, overviewOf, async () => pageMetadata(parent, ROUTES.teamOverview, address(await params)));
}

/** A stored day and hour as a match row writes them. */
const whenOf = ({ date, time }: FLSpielbestaetigungAppointment): Copy => COPY.spielplan.when(dayOf(date), timeOf(time));

const venueOf = (ansetzung: FLSpielbestaetigungViewAnsetzung): Words | null =>
  ansetzung.spielort === null ? null : { record: ansetzung.spielort.name };

/** The other club of the fixture, whose decline proposes the date the team is asked about. */
const opponentOf = ({ ansetzung, side }: FLTeamPanelTermin): Words => ({
  record: side === "team1" ? ansetzung.team2_name : ansetzung.team1_name,
});

/**
 * A date the league asked the team about. Unanswered and still in time, it is answered on its row: the line names the
 * ground, or the other club's proposal in its place, and when the answer is due. Past its deadline the backend takes no
 * answer, and a declined one waits on the league with the team's own proposal: neither carries an act. An agreed date
 * is no row of the read; one it serves anyway says so and carries none either.
 */
function terminRow(row: FLTeamPanelTermin, team: string, saison: string, today: CalendarDay): Row {
  const { ansetzung } = row;
  const when = whenOf(ansetzung);
  const deadline = dayOf(row.deadline);
  const base = {
    id: row.spielbestaetigung_id,
    href: ROUTES.teamAufstellung.path(team, saison, row.spiel_id),
    name: matchName(ansetzung.team1_name, ansetzung.team2_name),
  };
  switch (row.state) {
    case "valid":
    case "vorschlag": {
      const proposal = row.state === "vorschlag" && row.vorschlag !== null ? WORDS.proposal(whenOf(row.vorschlag), opponentOf(row)) : null;
      const due = deadline === today ? WORDS.answerDue : COPY.admin.spiel.answerBy(deadline);
      return {
        ...base,
        line: line([when, proposal ?? venueOf(ansetzung), due]),
        acts: (
          <>
            <AgreeAct id={row.spielbestaetigung_id} />
            <DeclineDialog
              id={row.spielbestaetigung_id}
              spiel={base.name}
              today={today}
            />
          </>
        ),
      };
    }
    case "expired":
      return { ...base, line: line([when, venueOf(ansetzung), WORDS.answerOverdue(deadline), TEAM.leagueDecides]) };
    case "declined":
      return {
        ...base,
        chip: { tone: "danger", label: COPY.admin.spiel.declined },
        line: line([when, row.vorschlag === null ? null : COPY.admin.spiel.proposed(whenOf(row.vorschlag))]),
      };
    case "agreed":
      return { ...base, chip: { tone: "success", label: COPY.admin.spiel.zugesagt }, line: line([when, venueOf(ansetzung)]) };
  }
}

/**
 * A coming match the team has entered no line-up for, by the day it is due: until then, and overdue from then. From
 * the lock on only the league enters it, which its chip says.
 */
function aufstellungRow(row: FLTeamPanelAufstellung, team: string, saison: string): Row {
  const due = dayIn(new Date(row.marks.due_at));
  return {
    id: row.spiel_id,
    href: ROUTES.teamAufstellung.path(team, saison, row.spiel_id),
    name: matchName(row.ansetzung.team1_name, row.ansetzung.team2_name),
    ...(row.marks.phase === "locked" ? { chip: { tone: "neutral" as const, label: TEAM.aufstellung.locked } } : {}),
    line: line([whenOf(row.ansetzung), row.marks.phase === "open" ? TEAM.aufstellung.dueBy(due) : TEAM.aufstellung.overdueSince(due)]),
  };
}

/**
 * A registration awaiting the team's decision, which its own page takes: confirmed by the pupil or not, and what they
 * play, a line only where the pupil named a position or a Stufe.
 */
function registrierungRow(row: FLTeamPanelRegistrierung, team: string, saison: string): Row {
  const plays =
    row.position === null && row.stufe === null
      ? null
      : line([row.position === null ? null : { record: row.position }, row.stufe === null ? null : COPY.admin.saison.stufe[row.stufe]]);
  return {
    id: row.registrierung_id,
    href: ROUTES.teamRegistrierungen.path(team, saison),
    name: { record: `${row.first_name} ${row.last_name}` },
    chip: row.admissible ? { tone: "success", label: COPY.admin.confirmed } : { tone: "warn", label: COPY.admin.schiedsrichter.unconfirmed },
    ...(plays === null ? {} : { line: plays }),
  };
}

/**
 * A person on the seats, read-only: who, which seats they hold, as the league's own team block folds a Trainer's second
 * seat into one row, and whether they confirmed; an empty seat muted. A row's seats are its key, no seat held twice.
 */
function seatRow(seat: FLTeamSeat) {
  const held = COPY.admin.seatLine(seat.rollen, null, null);
  return seat.name === null
    ? { id: seat.rollen.join(" "), name: COPY.admin.seatEmpty, chips: [], line: held, muted: true }
    : {
        id: seat.rollen.join(" "),
        name: { record: seat.name },
        chips: [
          seat.confirmed ? { tone: "success" as const, label: COPY.admin.confirmed } : { tone: "warn" as const, label: COPY.template.open },
        ],
        line: held,
      };
}

/** The team, its open work and its seats, read once for the seat the person holds at the address. */
async function readOverview(params: Props["params"]) {
  const [seat] = await requireTeamSeats(params, address);
  const { team_id: team, saison_id: saison } = seat;
  const read = await readAsSeatHolder(() => overviewOf(seat));
  // The league's calendar day, which the backend judges a deadline and a proposal's day by.
  const today = dayIn(now());
  return {
    team: { plaque: { record: read.shorthand }, name: { record: read.full_name } },
    cards: [
      { id: "termine", title: TITLES.termine, rows: read.termine.map((row) => terminRow(row, team, saison, today)) },
      { id: "aufstellungen", title: TITLES.aufstellungen, rows: read.aufstellungen.map((row) => aufstellungRow(row, team, saison)) },
      { id: "registrierungen", title: TITLES.registrierungen, rows: read.registrierungen.map((row) => registrierungRow(row, team, saison)) },
    ],
    seats: { title: TITLES.seats, rows: read.seats.map(seatRow) },
  };
}

/**
 * The team contact's Übersicht of one season: the team's head, then its open work in three boxes, every box drawn
 * every day, the dates answered on their rows and everything else opening its own page, then its seats, read-only.
 */
export default function TeamOverviewPage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "teamOverview" } }}
      list={{
        kind: "cards",
        wait: {
          team: true,
          rows: 2,
          cards: [
            { title: TITLES.termine, acts: [COPY.shared.verb.agree, COPY.shared.verb.decline] },
            { title: TITLES.aufstellungen },
            { title: TITLES.registrierungen },
          ],
          seats: TITLES.seats,
        },
        content: readOverview(params),
      }}
    />
  );
}
