import { cache } from "react";
import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";
import { TextField } from "@/kit/TextField";

import { requires } from "@/core/action";
import { COPY } from "@/core/copy";
import { isRecordMissing } from "@/core/errors";
import { dayOf, formatList, timeOf } from "@/core/format";
import { saisonsGetSaisonOverview } from "@/core/generated/client/sdk";
import {
  SpielbestaetigungenEnterSpielbestaetigungBody,
  spielbestaetigungenEnterSpielbestaetigungBodyReasonMax,
  SpielbestaetigungenEnterSpielbestaetigungParams,
} from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { runAdminRead } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { TerminDialog } from "./TerminDialog";
import { VorschlagActs } from "./VorschlagActs";
import { ZusageDialog } from "./ZusageDialog";

import type { Copy, Words } from "@/core/copy";
import type {
  FLBracketFault,
  FLOverviewRow,
  FLSpielJoinedAdmin,
  FLSpielRecipientSchiedsrichter,
  FLSpielRecipientTeam,
} from "@/core/generated/client/types";
import type { CardActRowProps } from "@/kit/Card";
import type { Metadata, ResolvingMetadata } from "next";
import type { ReactElement } from "react";
import type { OpenParty } from "./ZusageDialog";

type Props = PageProps<"/admin/saisons/[saison]">;

const WORDS = SERVER_COPY.overview;
const SPIEL = COPY.admin.spiel;
const FACTS = COPY.admin.facts;

/** The season's open work, `null` for a season the league does not hold: one read for the tab's title and the page alike. */
const overviewOf = cache((saison: string) =>
  runAdminRead(() =>
    saisonsGetSaisonOverview(saison).catch((error: unknown) => {
      if (isRecordMissing(error)) return null;
      throw error;
    }),
  ),
);

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(overviewOf(saison), () => pageMetadata(parent, ROUTES.adminOverview, ROUTES.adminOverview.path(saison)));
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

/**
 * The question's „Mail an“ fact: the parties the backend mails of the act, which it serves beside the row each by the
 * name its own record holds, in their names' order as the match editor's question lists them, none where the act mails
 * nobody, so the question names no mail that is never sent.
 */
function mailTo(recipients: readonly (FLSpielRecipientTeam | FLSpielRecipientSchiedsrichter)[]) {
  const names = recipients.map(({ name }) => name).toSorted((one, other) => one.localeCompare(other, "de"));
  return names.length === 0 ? [] : [{ label: FACTS.mailTo, value: { record: formatList(names) } }];
}

/** A stored day and hour as the catalogue's sentences take a slot. */
const slotOf = (date: string | null, time: string | null) => ({ day: dayOf(date), time: timeOf(time) });

const BOOKED = { ort: COPY.admin.spielort.object, schiedsrichter: COPY.shared.schiedsrichter } as const;

/** A fault of the bracket or of the fixture's bookings, in one line. */
function faultLine(fault: FLBracketFault): Copy {
  const words = WORDS.fault;
  switch (fault.reason) {
    case "gruppe_too_small":
    case "tie_unresolved":
      return words[fault.reason](fault.gruppe, fault.platz);
    case "gruppe_not_run":
    case "seed_past_the_opening_round":
    case "spiel_missing":
    case "reference_cycle":
    case "gruppenphase_feeder":
    case "feeder_not_played_first":
    case "same_team":
    case "gruppenphase_fixture_wired":
    case "source_feeds_another_fixture":
      return words.wiring;
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
const PARTY_REQUIRED = requires(SpielbestaetigungenEnterSpielbestaetigungParams.shape.spielbestaetigung_id, "");

/** The box asking how a party's agreement reached the league, drawn here so the write's schema stays on the server. */
function ReasonField() {
  return (
    <TextField
      label={COPY.admin.overview.reason}
      // The name `enterZusage` reads the reason by.
      name="reason"
      // A paragraph: a reason a person writes, at four lines, its line breaks kept.
      width="W4"
      kind="text"
      isRequired={requires(SpielbestaetigungenEnterSpielbestaetigungBody.shape.reason, "")}
      maxLength={spielbestaetigungenEnterSpielbestaetigungBodyReasonMax}
    />
  );
}

/** What is open on a fixture's row, and the act done there where the row offers one. */
function openOf(row: Exclude<FLOverviewRow, { kind: "bewerbung" }>): { line: Copy; acts?: ReactElement } {
  const { spiel } = row;
  switch (row.kind) {
    case "spielbestaetigung_due":
    case "spielbestaetigung_overdue": {
      const parties = row.parties.map((party): OpenParty => ({ id: party.spielbestaetigung_id, name: { record: party.name } }));
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
      const proposed = slotOf(row.vorschlag.date, row.vorschlag.time);
      const current = slotOf(spiel.date, spiel.time);
      const [from, to] = [COPY.spielplan.when(current.day, current.time), COPY.spielplan.when(proposed.day, proposed.time)];
      return {
        line: WORDS.proposal(to, team),
        acts: (
          <VorschlagActs
            id={row.spielbestaetigung_id}
            adopt={{
              consequence: WORDS.adoptConsequence,
              facts: [{ label: FACTS.before, value: from }, { label: FACTS.after, value: to }, ...mailTo(row.adoption_recipients)],
            }}
            discard={{
              consequence: WORDS.discardConsequence,
              facts: [
                { label: COPY.admin.overview.termin, value: from },
                { label: COPY.admin.overview.vorschlag, value: to },
                ...mailTo(row.discard_recipients),
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
            date={dayOf(spiel.date)}
            time={timeOf(spiel.time)}
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
  const read = await overviewOf(saison);
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
      list={{
        kind: "cards",
        wait: [
          { title: WORDS.card.due, acts: [COPY.shared.withObject(COPY.admin.overview.zusage, "enter")] },
          { title: WORDS.card.ergebnisse },
          { title: WORDS.card.dates, acts: [COPY.shared.withObject(COPY.admin.overview.termin, "set")] },
          { title: WORDS.card.bewerbungen },
        ],
        content: readOverview(params),
      }}
    />
  );
}
