import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";
import { TextField } from "@/kit/TextField";

import { COPY } from "@/core/copy";
import { isRecordMissing } from "@/core/errors";
import { dayOf, formatList, timeOf } from "@/core/format";
import { saisonsGetSaisonOverview } from "@/core/generated/client/sdk";
import {
  SpielbestaetigungenEnterSpielbestaetigungBody,
  spielbestaetigungenEnterSpielbestaetigungBodyBegruendungMax,
  SpielbestaetigungenEnterSpielbestaetigungParams,
} from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runAdminRead } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";

import { TerminDialog } from "./TerminDialog";
import { VorschlagActs } from "./VorschlagActs";
import { ZusageDialog } from "./ZusageDialog";

import type { Copy, Words } from "@/core/copy";
import type { FLBracketFault, FLOverviewRow, FLSpielJoinedAdmin, FLSpielQuelle } from "@/core/generated/client/types";
import type { CardActRowProps } from "@/kit/Card";
import type { Metadata, ResolvingMetadata } from "next";
import type { ReactElement } from "react";
import type { OpenParty } from "./ZusageDialog";

type Props = PageProps<"/admin/saisons/[saison]">;

const WORDS = SERVER_COPY.overview;
const SPIEL = COPY.admin.spiel;
const FACTS = COPY.admin.facts;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return pageMetadata(parent, ROUTES.adminOverview, ROUTES.adminOverview.path(saison));
}

/** A fixture by its two clubs, as the match editor names it, and by its number while a side is still open. */
const nameOf = (spiel: FLSpielJoinedAdmin): Copy =>
  spiel.team1 === null || spiel.team2 === null
    ? SPIEL.number(spiel.spiel_nr)
    : ROUTES.adminSpiel.title({ record: spiel.team1.name }, { record: spiel.team2.name });

/** A club of the fixture by its id, `null` where the fixture no longer fields it. */
function clubOf(spiel: FLSpielJoinedAdmin, teamId: string): Words | null {
  const side = [spiel.team1, spiel.team2].find((team) => team?.team_id === teamId);
  return side === undefined || side === null ? null : { record: side.name };
}

/** Everybody a move mails „Spiel verlegt“: both clubs and the booked referee, by the names the fixture holds. */
const partiesOf = (spiel: FLSpielJoinedAdmin): string[] =>
  [spiel.team1?.name, spiel.team2?.name, spiel.schiedsrichter?.name].filter((name): name is string => typeof name === "string");

/** A stored day and hour as the catalogue's sentences take a slot. */
const slotOf = (datum: string | null, uhrzeit: string | null) => ({ day: dayOf(datum), time: timeOf(uhrzeit) });

/** A side's source by its full name, „2. der Gruppe A“ or „Sieger von Spiel 12“. */
function quelleName(quelle: FLSpielQuelle): Copy {
  const words = COPY.spielplan.quelle;
  if (quelle.type === "gruppe") return words.gruppe(quelle.gruppe, quelle.platz);
  return quelle.ausgang === "sieger" ? words.sieger(quelle.spiel_nr) : words.verlierer(quelle.spiel_nr);
}

const BOOKED = { ort: COPY.admin.spielort.object, schiedsrichter: COPY.shared.schiedsrichter } as const;

/** A fault of the bracket or of the fixture's bookings, in one line. */
function faultLine(fault: FLBracketFault): Copy {
  const words = WORDS.fault;
  switch (fault.reason) {
    case "gruppe_too_small":
    case "tie_unresolved":
      return words[fault.reason](fault.gruppe, fault.platz);
    case "gruppe_not_run":
      return words.gruppe_not_run(fault.gruppe);
    case "seed_past_the_opening_round":
      return words.seed_past_the_opening_round;
    case "spiel_missing":
    case "reference_cycle":
    case "gruppenphase_feeder":
    case "feeder_not_played_first":
      return words[fault.reason](fault.quelle_spiel_nr);
    case "same_team":
    case "gruppenphase_fixture_wired":
      return words[fault.reason];
    case "source_feeds_another_fixture":
      return words.source_feeds_another_fixture(quelleName(fault.quelle));
    case "departed_occupant":
      return words.departed_occupant(
        { record: fault.team_name },
        COPY.shared.austrittSince(COPY.shared.austritt[fault.austritt_type].state, dayOf(fault.ausgeschieden_seit)),
      );
    case "fielded_twice":
      return words.fielded_twice({ record: fault.team_name });
    case "retired_booking":
      return words.retired_booking(BOOKED[fault.booking]);
    case "double_booked":
      return words.double_booked[fault.booking];
  }
}

/** Whether the Zusage's write asks for the party's row, which its segments choose. */
const PARTY_REQUIRED = !SpielbestaetigungenEnterSpielbestaetigungParams.shape.spielbestaetigung_id.safeParse("").success;

/** The box asking how a party's agreement reached the league, drawn here so the write's schema stays on the server. */
function ReasonField() {
  return (
    <TextField
      label={COPY.admin.overview.reason}
      // The name `enterZusage` reads the reason by.
      name="begruendung"
      width="W3"
      kind="text"
      isRequired={!SpielbestaetigungenEnterSpielbestaetigungBody.shape.begruendung.safeParse("").success}
      maxLength={spielbestaetigungenEnterSpielbestaetigungBodyBegruendungMax}
    />
  );
}

/** What is open on a fixture's row, and the act done there where the row offers one. */
function openOf(row: Exclude<FLOverviewRow, { kind: "bewerbung" }>): { line: Copy; acts?: ReactElement } {
  const { spiel } = row;
  switch (row.kind) {
    case "spielbestaetigung_due":
    case "spielbestaetigung_overdue": {
      const parties = row.parties.map((party): OpenParty => ({
        id: party.spielbestaetigung_id,
        name: clubOf(spiel, party.team_id) ?? nameOf(spiel),
      }));
      // The earliest deadline a club of the row was given, which its answer is overdue since.
      const deadline = row.parties.map((party) => party.deadline).toSorted()[0];
      const line = row.kind === "spielbestaetigung_due" || deadline === undefined ? WORDS.answerDue : WORDS.answerOverdue(dayOf(deadline));
      const [first, ...rest] = parties;
      return first === undefined
        ? { line }
        : {
            line,
            acts: (
              <ZusageDialog
                parties={[first, ...rest]}
                partyRequired={PARTY_REQUIRED}>
                <ReasonField />
              </ZusageDialog>
            ),
          };
    }
    case "vorschlag_open": {
      const team = clubOf(spiel, row.team_id);
      const proposed = slotOf(row.vorschlag.datum, row.vorschlag.uhrzeit);
      const current = slotOf(spiel.datum, spiel.uhrzeit);
      const [from, to] = [COPY.spielplan.when(current.day, current.time), COPY.spielplan.when(proposed.day, proposed.time)];
      return {
        line: WORDS.proposal(to, team),
        acts: (
          <VorschlagActs
            id={row.spielbestaetigung_id}
            adopt={{
              consequence: WORDS.adoptConsequence,
              facts: [
                { label: FACTS.before, value: from },
                { label: FACTS.after, value: to },
                { label: FACTS.mailTo, value: { record: formatList(partiesOf(spiel)) } },
              ],
            }}
            discard={{
              consequence: WORDS.discardConsequence,
              facts: [
                { label: COPY.admin.overview.termin, value: from },
                { label: SPIEL.proposal, value: to },
                { label: FACTS.mailTo, value: team ?? nameOf(spiel) },
              ],
            }}
          />
        ),
      };
    }
    case "spielbericht_open":
      return { line: WORDS.report[row.state] };
    case "bracket_fault":
      return { line: faultLine(row.fault) };
    case "termin_missing":
      return {
        line: WORDS.missing(COPY.admin.overview.termin),
        acts: (
          <TerminDialog
            spiel={spiel.id}
            version={spiel.version}
            datum={dayOf(spiel.datum)}
            uhrzeit={timeOf(spiel.uhrzeit)}
          />
        ),
      };
    case "ergebnis_missing":
      return { line: WORDS.missing(SPIEL.ergebnis) };
    case "spielort_missing":
      return { line: WORDS.missing(COPY.admin.spielort.object) };
    case "schiedsrichter_missing":
      return { line: WORDS.missing(COPY.shared.schiedsrichter) };
    case "team_missing":
      return { line: WORDS.missing(COPY.account.entries.facts.team) };
  }
}

/** One row of a card: an application opens its own page, every other row its fixture's editor. */
function rowOf(row: FLOverviewRow, saison: string): CardActRowProps & { id: string } {
  if (row.kind === "bewerbung") {
    return {
      id: row.bewerbung_id,
      href: ROUTES.adminBewerbung.path(row.bewerbung_id),
      name: { record: row.name },
      line: WORDS.seatsConfirmed(row.seats_confirmed, row.seats),
    };
  }
  const { line, acts } = openOf(row);
  return {
    // A fixture stands once on a card.
    id: row.spiel.id,
    href: ROUTES.adminSpiel.path(saison, row.spiel.id),
    name: nameOf(row.spiel),
    line,
    ...(acts === undefined ? {} : { acts }),
  };
}

/** The season's open work, read once: not-found for a season the league does not hold. */
async function readOverview(params: Props["params"]) {
  const { saison } = await params;
  const read = await runAdminRead(() =>
    saisonsGetSaisonOverview(saison).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  );
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
 * page.
 */
export default function UebersichtPage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminOverview" } }}
      list={{ kind: "cards", content: readOverview(params) }}
    />
  );
}
