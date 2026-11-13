import { cache } from "react";
import { notFound } from "next/navigation";

import { AGREED_CHIP, DECLINED_CHIP, EXPIRED_CHIP } from "@/kit/stateChips";

import { requires } from "@/core/action";
import { COPY } from "@/core/copy";
import { dayOf, formatDate, timeOf } from "@/core/format";
import { FLSonderereignis } from "@/core/generated/client/types";
import { SpielePatchSpielBody, spielePatchSpielBodyNoteOneMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { AUFSTELLUNG_CHIP, STARTERS_MAX } from "@/features/aufstellungen/constants";
import { adminSpielChipOf, eventOf, previewOf, quelleWords } from "@/features/spiele/blocks";
import { getAdminSpiel } from "@/features/spiele/queries";
import { creditedSide, isNoShow } from "@/features/spiele/result";
import { spielerName } from "@/features/spieler/constants";
import { adminIdParamOf } from "@/shared/utils/adminRead";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { createSpielort } from "../../../../../createSpielort";
import { SPIELORT_RULES } from "../../../../../spielortRules";
import { saveSpiel } from "./saveSpiel";
import { SpielEditor } from "./SpielEditor";
import { NO_SONDEREREIGNIS, NOBODY, takesNoResult, valuesOf } from "./spielValues";

import type { Copy, Words } from "@/core/copy";
import type {
  FLSpielbestaetigungEditorRow,
  FLSpieleAdminSingleResponse,
  FLSpielEditorBericht,
  FLSpielJoinedAdmin,
  FLSpielTeamFieldJoined,
} from "@/core/generated/client/types";
import type { AnswerRow } from "@/kit/AnswerRows";
import type { CardActRowProps } from "@/kit/Card";
import type { Option } from "@/kit/OptionList";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";
import type { Adoption, Club } from "./SpielEditor";
import type { SpielValues } from "./spielValues";

type Props = PageProps<"/admin/saisons/[saison]/spiele/[spiel]">;

const WORDS = COPY.admin.spiel;

const SONDEREREIGNISSE: Readonly<Record<FLSonderereignis, Copy>> = {
  ausgefallen: WORDS.ausgefallen,
  nichtantreten_team1: WORDS.nichtantretenTeam1,
  nichtantreten_team2: WORDS.nichtantretenTeam2,
  abgebrochen: WORDS.abgebrochen,
  annulliert: WORDS.annulliert,
};

const { spielort, schiedsrichter } = SpielePatchSpielBody.shape;

/** Whether a booking's money is required beside it, read off the write's schema. */
const REQUIRED = {
  mietpreis: requires(spielort.options[0].shape.mietpreis, null),
  payment: requires(schiedsrichter.options[0].shape.payment, null),
};

/** The report's table, whose cells `berichtRows` fills: the editor draws its rows under it. */
const REPORT_HEAD: TableHead = {
  nameLabel: COPY.shared.spieler,
  stack: true,
  columns: [
    { key: "event", label: WORDS.event },
    { key: "minute", label: WORDS.minute, figures: true },
    { key: "score", label: WORDS.ergebnis, figures: true },
  ],
};

/** One read of the editor's whole view, for the tab's title and the page alike. */
const read = cache(getAdminSpiel);

/**
 * The fixture the address names, as every season page reads its record: `null` for a malformed id, for none by it,
 * and for one of another season.
 */
async function findSpiel(params: Props["params"]): Promise<FLSpieleAdminSingleResponse | null> {
  const spiel = await adminIdParamOf(params, "spiel");
  const { saison } = await params;
  const view = spiel === null ? null : await read(spiel);
  return view === null || view.spiel.saison_id !== saison ? null : view;
}

async function readSpiel(params: Props["params"]): Promise<FLSpieleAdminSingleResponse> {
  const view = await findSpiel(params);
  if (view === null) notFound();
  return view;
}

/** A match is named by its two teams, as its own page is, and by its number while a side is still open. */
const nameOf = (spiel: FLSpielJoinedAdmin) =>
  spiel.team1 === null || spiel.team2 === null
    ? WORDS.number(spiel.spiel_nr)
    : ROUTES.adminSpiel.title({ record: spiel.team1.name }, { record: spiel.team2.name });

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(findSpiel(params), ({ spiel }) =>
    pageMetadata(parent, ROUTES.adminSpiel, ROUTES.adminSpiel.path(spiel.saison_id, spiel.id), { title: nameOf(spiel) }),
  );
}

/** The match editor, on its one view read. */
export default async function SpielEditorPage({ params }: Props) {
  return await readEditor(params);
}

/** A pupil a goal names, by the names their record holds; a goal naming nobody, „anonym“. */
function scorerOf(bericht: FLSpielEditorBericht, spielerId: string | null): Words {
  const named = spielerId === null ? undefined : bericht.named.find((spieler) => spieler.spieler_id === spielerId);
  return named === undefined ? COPY.shared.anonymous : spielerName(named);
}

/** A minute as the report writes it, „45+2“, in the order it was played. */
const minuteOf = (minute: string): [number, number] => {
  const [base = "0", added = "0"] = minute.split("+");
  return [Number(base), Number(added)];
};

/**
 * The report's goals as rows, read-only, since its referee writes them: each in the order it was scored, the side's
 * plaque before the scorer, and the score the goal made. An own goal counts for the other side.
 */
function berichtRows(spiel: FLSpielJoinedAdmin, bericht: FLSpielEditorBericht): TableRow[] {
  const words = SERVER_COPY.season.spiel;
  const plaques = { team1: spiel.team1?.shorthand ?? null, team2: spiel.team2?.shorthand ?? null };
  const score = { team1: 0, team2: 0 };
  return bericht.scorers
    .map((tor, index) => ({ tor, index }))
    .toSorted((one, other) => {
      const [a, b] = [minuteOf(one.tor.minute), minuteOf(other.tor.minute)];
      return a[0] - b[0] || a[1] - b[1] || one.index - other.index;
    })
    .map(({ tor, index }) => {
      score[creditedSide(tor)] += 1;
      const plaque = plaques[tor.side];
      return {
        id: String(index),
        name: scorerOf(bericht, tor.spieler_id),
        ...(plaque === null ? {} : { plaque: { record: plaque } }),
        cells: {
          event: tor.eigentor ? words.eigentor : words.tor,
          minute: { record: tor.minute },
          score: WORDS.score(score, null),
        },
      };
    });
}

/** The referee's proposal as „Übernehmen“ carries it into the result's fields, where the report stands open to it. */
function adoptionOf(spiel: FLSpielJoinedAdmin, bericht: FLSpielEditorBericht | null): Adoption | null {
  if (bericht === null || (bericht.state !== "proposed" && bericht.state !== "differing")) return null;
  const { team1_tore: tore1, team2_tore: tore2, elfmeterschiessen, sonderereignis } = bericht.ergebnis_vorschlag;
  const event = sonderereignis ?? NO_SONDEREREIGNIS;
  // A no-show's goals are the award the write composes: the proposal names the side that stayed away alone.
  if (isNoShow(sonderereignis)) {
    const words = eventOf({ ...spiel, sonderereignis, ergebnis: null });
    return words === null
      ? null
      : {
          version: bericht.version,
          text: WORDS.fromReport(words.title),
          values: { sonderereignis: event, hasResult: false, tore1: "", tore2: "" },
        };
  }
  if (tore1 === null || tore2 === null) return null;
  const values: Partial<SpielValues> = {
    sonderereignis: event,
    hasResult: true,
    tore1: String(tore1),
    tore2: String(tore2),
    shootOut1: elfmeterschiessen === null ? "" : String(elfmeterschiessen.team1),
    shootOut2: elfmeterschiessen === null ? "" : String(elfmeterschiessen.team2),
  };
  return { version: bericht.version, text: WORDS.fromReport(WORDS.score({ team1: tore1, team2: tore2 }, elfmeterschiessen)), values };
}

/** An answer the party has not given: the chip of one still owed, and the line of one that lapsed on no day. */
const ANSWER_MISSING = SERVER_COPY.overview.missing(COPY.area.answer);

/**
 * One party's answer as a row, by the state its newest row reads as: its name, its chip, and under them the answer's
 * day, the day it is due by, or that the party has not been asked; a declining club's proposed date after its day, and
 * its reason in its own words. An answer that lapsed unanswered, which the party can no longer give, says so and the day
 * it lapsed on, as every other page under that chip does; one an exit or a decision ended lapsed on no day, and its line
 * says the answer is missing. A discarded proposal reads as the agreement the fixture counts. An answer about a slot the
 * match has left is drawn as given beside that slot, which it alone is about. A row about a slot the match has left that
 * holds no answer, or about a call-off since undone, asks nothing about the match as it stands, and a row in time that
 * nobody could be mailed on has asked nothing yet: the party reads as not asked.
 */
function answerRow(id: string, name: Words, plaque: string | null, row: FLSpielbestaetigungEditorRow | undefined): AnswerRow {
  const shown = { id, name, ...(plaque === null ? {} : { plaque: { record: plaque } }) };
  // Both wait in the warn hue: a party never asked on the league, one asked on its answer, in the word its own list says.
  if (
    row === undefined ||
    (row.state === "invalid" && row.answer === null) ||
    row.state === "cancelled" ||
    (row.state === "valid" && row.asked_at === null)
  ) {
    return { ...shown, chip: { tone: "warn", label: COPY.template.open }, line: WORDS.notAsked };
  }
  if (row.state === "expired") {
    const line = row.lapsed_on === null ? ANSWER_MISSING : COPY.admin.schiedsrichter.expiredOn(dayOf(row.lapsed_on));
    return { ...shown, chip: EXPIRED_CHIP, line };
  }
  const { answer } = row;
  // Unanswered and in time: its party may still answer, a referee until the slot's day, which no deadline binds.
  if (answer === null) return { ...shown, chip: { tone: "warn", label: ANSWER_MISSING }, line: WORDS.answerBy(dayOf(row.due_by)) };
  const reason = answer.reason === null ? {} : { reason: { record: answer.reason } };
  if (row.state === "invalid") {
    const slot = SERVER_COPY.season.labelled(
      COPY.admin.facts.before,
      COPY.spielplan.when(dayOf(row.ansetzung.date), timeOf(row.ansetzung.time)),
    );
    return answer.kind === "agreed" ? { ...shown, chip: AGREED_CHIP, line: slot } : { ...shown, chip: DECLINED_CHIP, line: slot, ...reason };
  }
  const day: Words = answer.by.kind === "admin" ? WORDS.enteredByLeague : { record: formatDate(dayOf(answer.at)) };
  // The chip follows the state, so a decline whose proposal the league discarded reads as the agreement it counts as.
  if (row.state === "agreed") {
    return answer.kind === "agreed"
      ? { ...shown, chip: AGREED_CHIP, line: day }
      : { ...shown, chip: AGREED_CHIP, line: COPY.admin.actionLog.action["spielbestaetigung.vorschlag_discarded"], ...reason };
  }
  const { vorschlag } = answer;
  const line =
    vorschlag === null
      ? day
      : SERVER_COPY.season.labelled(day, WORDS.proposed(COPY.spielplan.when(dayOf(vorschlag.date), timeOf(vorschlag.time))));
  return { ...shown, chip: DECLINED_CHIP, line, ...reason };
}

/**
 * Each party's answer about the fixture as it stands, by the party's newest row, a closed one too, which still holds
 * the answer or that it lapsed: both clubs, then the referee where a booking names one. An event ends every question
 * still owed about the match, so on a match carrying one only a party that agreed or declined shows, its answer being
 * what it said of the match before the event.
 */
function answerRows(view: FLSpieleAdminSingleResponse): AnswerRow[] {
  const { spiel, spielbestaetigungen: rows } = view;
  const party = (id: string, name: Words, plaque: string | null, row: FLSpielbestaetigungEditorRow | undefined) =>
    spiel.sonderereignis === null || row?.state === "agreed" || row?.state === "declined" ? [answerRow(id, name, plaque, row)] : [];
  // The rows are served newest first, so a party's first row is its newest.
  const club = (side: "team1" | "team2", team: FLSpielTeamFieldJoined | null) =>
    team === null
      ? []
      : party(
          side,
          { record: team.name },
          team.shorthand,
          rows.find((row) => row.party.kind === "team" && row.party.team_id === team.team_id),
        );
  const booked = spiel.schiedsrichter;
  // A booking naming nobody, which an erasure leaves on a played match, has no party to ask or to answer.
  const referee =
    booked === null || booked.name === null
      ? []
      : party(
          "schiedsrichter",
          { record: booked.name },
          null,
          rows.find((row) => row.party.kind === "schiedsrichter" && row.party.schiedsrichter_id === booked.schiedsrichter_id),
        );
  return [...club("team1", spiel.team1), ...club("team2", spiel.team2), ...referee];
}

/**
 * A row per side leading to its club's line-up, under the club's name: how many it names and how many start, or
 * „Fehlt“ where none is stored, with the club's own pages' „Überfällig“ from its due mark on, past the club's lock
 * too. A side the draw has not settled has no club to name one, and a match with no day or hour owes none, so neither
 * shows a row. A match carrying any event owes none either, as the club's own pages read it, yet the league still enters
 * its line-ups: each row stays with what is stored, and nothing on it says one is owed.
 */
function aufstellungRows(view: FLSpieleAdminSingleResponse): Array<CardActRowProps & { id: string }> {
  const { spiel, aufstellungen, aufstellung_marks: marks } = view;
  if (spiel.date === null || spiel.time === null) return [];
  // The served marks read the clock alone and never the event, so the page judges the event itself.
  const owed = spiel.sonderereignis === null;
  const words = COPY.area.team.aufstellung;
  return (["team1", "team2"] as const).flatMap((side) => {
    const club = spiel[side];
    if (club === null) return [];
    const stored = aufstellungen[side];
    const mark = marks[side];
    // The club's lock locks nothing for the league, which still enters the line-up: a missing one past it is overdue here.
    const chip = !owed || mark === null || mark.stored ? undefined : AUFSTELLUNG_CHIP[mark.phase === "locked" ? "overdue" : mark.phase];
    const line = stored !== null ? words.counts(stored.count, stored.starters, STARTERS_MAX) : owed ? words.missing : undefined;
    return [
      {
        id: side,
        href: ROUTES.adminAufstellung.path(spiel.saison_id, spiel.id, club.team_id),
        name: words.ofTeam({ record: club.name }),
        ...(chip === undefined ? {} : { chip }),
        ...(line === undefined ? {} : { line }),
      },
    ];
  });
}

/** A knockout match's clubs for its two sides by hand, each a club the write would not field noted why. */
function clubsOf(view: FLSpieleAdminSingleResponse): Club[] | null {
  return (
    view.teams?.map((team) =>
      team.fieldable
        ? { id: team.id, name: team.name, shorthand: team.shorthand }
        : { id: team.id, name: team.name, shorthand: team.shorthand, note: team.on_spieltag ? WORDS.onSpieltag : WORDS.departed },
    ) ?? null
  );
}

async function readEditor(params: Props["params"]) {
  const view = await readSpiel(params);
  const { spiel: saved } = view;
  // A finished season's matches take no write (`saison_past`), so the editor opens on one read-only.
  const closed = view.saison_status === "past";

  // An event recording the match waits for the season's start, and a no-show needs both sides: the write refuses
  // either, so it is offered disabled. A call-off and a strike-out record nothing and stay open before the start.
  const begun = view.saison_begun;
  const bothSides = saved.team1 !== null && saved.team2 !== null;
  const sonderereignisse: Option[] = [
    { id: NO_SONDEREREIGNIS, label: WORDS.none },
    ...Object.values(FLSonderereignis).map((event): Option => {
      const label = SONDEREREIGNISSE[event];
      if (!begun && !takesNoResult(event)) return { id: event, label, isDisabled: true, note: COPY.admin.fromStart };
      return !bothSides && isNoShow(event) ? { id: event, label, isDisabled: true, note: WORDS.needsBothSides } : { id: event, label };
    }),
  ];

  return (
    <SpielEditor
      title={nameOf(saved)}
      chip={adminSpielChipOf(saved)}
      preview={previewOf(saved)}
      record={{ id: saved.id, version: saved.version, values: valuesOf(saved) }}
      save={saveSpiel}
      phase={saved.saison_phase}
      begun={begun}
      sides={{
        team1: saved.team1 === null ? null : { name: { record: saved.team1.name }, plaque: { record: saved.team1.shorthand } },
        team2: saved.team2 === null ? null : { name: { record: saved.team2.name }, plaque: { record: saved.team2.shorthand } },
      }}
      quellen={{ team1: quelleWords(saved.team1_quelle)?.long ?? null, team2: quelleWords(saved.team2_quelle)?.long ?? null }}
      clubs={clubsOf(view)}
      spielorte={view.spielorte.map((spielort) => ({
        // The match's own retired venue stays in the list, marked and not to be chosen again once left.
        option:
          spielort.inactive_since === null
            ? { id: spielort.id, label: { record: spielort.name } }
            : { id: spielort.id, label: { record: spielort.name }, isDisabled: true, note: COPY.shared.retired },
        price: spielort.default_mietpreis,
      }))}
      schiedsrichter={[
        // A booking naming nobody, offered only where the match holds one, so a save keeps it and its fee: the write makes
        // none.
        ...(saved.schiedsrichter !== null && saved.schiedsrichter.schiedsrichter_id === null
          ? [{ option: { id: NOBODY, label: COPY.shared.nobody }, price: saved.schiedsrichter.payment }]
          : []),
        ...view.schiedsrichter.map((person): { option: Option; price: number } => ({
          // A referee who has not confirmed their entry is listed, so they read as waiting and never as missing, and is
          // not to be chosen; the match's own retired referee stays listed as its retired venue does.
          option:
            person.inactive_since !== null
              ? { id: person.id, label: { record: person.name }, isDisabled: true, note: COPY.shared.retired }
              : person.confirmed
                ? { id: person.id, label: { record: person.name } }
                : { id: person.id, label: { record: person.name }, isDisabled: true, note: COPY.admin.schiedsrichter.unconfirmed },
          price: person.default_payment,
        })),
      ]}
      sonderereignisse={sonderereignisse}
      noteMax={spielePatchSpielBodyNoteOneMax}
      required={REQUIRED}
      report={{ head: REPORT_HEAD, rows: view.spielbericht === null ? [] : berichtRows(saved, view.spielbericht) }}
      adoption={adoptionOf(saved, view.spielbericht)}
      answers={answerRows(view)}
      aufstellungen={aufstellungRows(view)}
      createSpielort={createSpielort}
      spielortRules={SPIELORT_RULES}
      {...(closed ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
      // A planned season's match page answers not found to the public, so the strip offers none.
      {...(view.saison_status === "future" ? {} : { spielPage: ROUTES.spiel.path(saved.saison_id, saved.id) })}
    />
  );
}
