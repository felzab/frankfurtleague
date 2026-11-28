import { notFound, redirect } from "next/navigation";

import { boxRulesOf } from "@/core/action";
import { ADMIN_COPY } from "@/core/copy/admin";
import { COPY } from "@/core/copy/shared";
import { dayOf, timeOf } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getSaisonOverview } from "@/features/saisons/queries";
import { vorschlagActs, zusageAct } from "@/features/spielbestaetigungen/answerActs";
import { saveSpiel } from "@/features/spiele/saveSpiel";
import { ListPage } from "@/kit/ListPage";
import { DECLINED_CHIP, EXPIRED_CHIP } from "@/kit/stateChips";

import { AppointmentDialog } from "./AppointmentDialog";

import type { Copy, Words } from "@/core/copy";
import type { FLOverviewFault, FLOverviewParty, FLOverviewRow, FLSpielJoinedAdmin } from "@/core/generated/client/types";
import type { OpenParty } from "@/features/spielbestaetigungen/ZusageDialog";
import type { CardActRowProps } from "@/kit/Card";
import type { ChipProps } from "@/kit/Chip";
import type { ReactElement } from "react";

const WORDS = SERVER_COPY.overview;
const SPIEL = ADMIN_COPY.spiel;

/** A fixture by its two clubs, as the match editor names it, and by its number while a side is still open. */
const nameOf = (spiel: FLSpielJoinedAdmin): Copy =>
  spiel.team1 === null || spiel.team2 === null
    ? SPIEL.number(spiel.spiel_nr)
    : ROUTES.adminSpiel.title({ record: spiel.team1.name }, { record: spiel.team2.name });

/** A club of the fixture by its id, `null` where the fixture no longer fields it. */
function teamOf(spiel: FLSpielJoinedAdmin, teamId: string): Words | null {
  const side = [spiel.team1, spiel.team2].find((team) => team?.team_id === teamId);
  return side === undefined || side === null ? null : { record: side.name };
}

const appointmentOf = (date: string | null, time: string | null) => ({ day: dayOf(date), time: timeOf(time) });

const BOOKED = { spielort: ADMIN_COPY.spielort.object, schiedsrichter: COPY.shared.schiedsrichter } as const;

/** A fault of the bracket or of the fixture's bookings, in one line. */
function faultLine(fault: FLOverviewFault): Copy {
  const words = WORDS.fault;
  switch (fault.reason) {
    case "gruppe_too_small":
    case "tie_unresolved":
      return words[fault.reason](fault.gruppe, fault.platz);
    case "wiring":
      return words.wiring;
    case "departed_occupant":
      return words.departed_occupant(
        { record: fault.team_name },
        COPY.shared.austrittSince(COPY.shared.austritt[fault.austritt_type].state, dayOf(fault.exited_since)),
      );
    case "fielded_twice":
      return words.fielded_twice({ record: fault.team_name });
    case "retired_booking":
      return words.retired_booking(BOOKED[fault.booking]);
    case "double_booked":
      return words.double_booked[fault.booking];
  }
}

/**
 * A fixture's answers still due, by the party owing first, as the match editor words that party's row: by the day it is
 * due by, a club's deadline and a referee's kick-off day, and a club whose request was never mailed as not asked.
 */
function dueLine(parties: readonly FLOverviewParty[]): Copy {
  const [owing] = parties.toSorted((one, other) => one.due_by.localeCompare(other.due_by));
  if (owing === undefined) return WORDS.missing(COPY.spielplan.answer);
  return owing.asked_at === null ? SPIEL.notAsked : COPY.shared.answerBy(dayOf(owing.due_by));
}

/**
 * What is open on a fixture's row, the chip of the trouble it is in where it is in some, and the act done there where
 * the row offers one.
 */
function openOf(row: Exclude<FLOverviewRow, { kind: "bewerbung" }>): { chip?: ChipProps; line: Copy; acts?: ReactElement } {
  const { spiel } = row;
  switch (row.kind) {
    case "spielbestaetigung_due":
    case "spielbestaetigung_overdue": {
      const parties = row.parties.map((party): OpenParty => ({ id: party.spielbestaetigung_id, name: { record: party.name } }));
      // The earliest day a party's answer lapsed on.
      const lapsed = row.parties.flatMap(({ lapsed_on }) => (lapsed_on === null ? [] : [lapsed_on])).toSorted()[0];
      const shown =
        row.kind === "spielbestaetigung_due" || lapsed === undefined
          ? { line: dueLine(row.parties) }
          : { chip: EXPIRED_CHIP, line: COPY.shared.onDay(dayOf(lapsed)) };
      const [first, ...rest] = parties;
      return first === undefined ? shown : { ...shown, acts: zusageAct([first, ...rest]) };
    }
    case "vorschlag_open": {
      const team = teamOf(spiel, row.team_id);
      const proposed = appointmentOf(row.vorschlag.date, row.vorschlag.time);
      return {
        chip: DECLINED_CHIP,
        line: WORDS.proposal(COPY.spielplan.when(proposed.day, proposed.time), team),
        acts: vorschlagActs(row.spielbestaetigung_id, spiel, row),
      };
    }
    case "spielbericht_open":
      return { line: WORDS.report[row.state] };
    case "bracket_fault":
      return { line: faultLine(row.fault) };
    case "appointment_missing":
      return {
        line: WORDS.missing(COPY.spielplan.appointment),
        acts: (
          <AppointmentDialog
            spiel={spiel.id}
            version={spiel.version}
            date={dayOf(spiel.date)}
            time={timeOf(spiel.time)}
            rules={boxRulesOf(saveSpiel)}
          />
        ),
      };
    case "ergebnis_missing":
      return { line: WORDS.missing(COPY.spielplan.ergebnis) };
    case "spielort_missing":
      return { line: WORDS.missing(ADMIN_COPY.spielort.object) };
    case "schiedsrichter_missing":
      return { line: WORDS.missing(COPY.shared.schiedsrichter) };
    case "team_missing":
      return { line: WORDS.missing(COPY.shared.facts.team) };
  }
}

/** One row of a card: an application opens its own page, every other row its fixture's editor. */
function rowOf(row: FLOverviewRow, saison: string): CardActRowProps & { id: string } {
  if (row.kind === "bewerbung") {
    return {
      id: row.bewerbung_id,
      href: ROUTES.adminBewerbung.path(saison, row.bewerbung_id),
      name: { record: row.name },
      line: WORDS.seatsConfirmed(row.seats_confirmed, row.seats),
    };
  }
  const { chip, line, acts } = openOf(row);
  return {
    // A fixture stands once on a card.
    id: row.spiel.id,
    href: ROUTES.adminSpiel.path(saison, row.spiel.id),
    name: nameOf(row.spiel),
    ...(chip === undefined ? {} : { chip }),
    line,
    ...(acts === undefined ? {} : { acts }),
  };
}

/**
 * The season's open work, read once: not-found for a season the league does not hold, and the season list, where the
 * first is created, while the league holds none.
 */
async function readOverview(of: Promise<string | null>) {
  const saison = await of;
  if (saison === null) redirect(ROUTES.adminSaisons.path());
  const read = await getSaisonOverview(saison);
  if (read === null) notFound();
  return {
    cards: read.cards.map(({ card, rows }) => ({
      id: card,
      title: WORDS.card[card],
      rows: rows.map((row) => rowOf(row, saison)),
    })),
  };
}

/**
 * The administrator's Übersicht of one season: its open work on four cards in the order of urgency, every card drawn
 * every day, a fixture once on each, for its first open kind. A slot still to set, a club's Zusage heard elsewhere and
 * a club's proposed date are each done on their row; everything else opens the fixture's editor, or the application's
 * page. Drawn for the season the address names, and at `/admin` for the season the administration works in by standard.
 */
export function AdminOverview({ saison }: { saison: Promise<string | null> }) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminOverview" } }}
      list={{ kind: "cards", content: readOverview(saison) }}
    />
  );
}
