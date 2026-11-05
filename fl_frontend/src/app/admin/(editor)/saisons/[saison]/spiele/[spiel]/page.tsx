import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";

import { COPY } from "@/core/copy";
import { dayOf, formatDatum, timeOf } from "@/core/format";
import { FLSonderereignis } from "@/core/generated/client/types";
import { SpielePatchSpielBody, spielePatchSpielBodyNotizOneMax } from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { ereignisOf, quelleWords } from "@/features/spiele/blocks";
import { getAdminSpiel } from "@/features/spiele/queries";
import { pageMetadata } from "@/shared/utils/metadata";
import { resolveObjectIdParam } from "@/shared/utils/routeParams";

import { createSpielort } from "../../../../../createSpielort";
import { SPIELORT_RULES } from "../../../../../spielortRules";
import { previewSpiel, saveSpiel } from "./saveSpiel";
import { SpielEditor } from "./SpielEditor";
import { NO_SONDEREREIGNIS, valuesOf } from "./spielValues";

import type { Copy, Words } from "@/core/copy";
import type {
  FLSpielbestaetigung,
  FLSpieleAdminSingleResponse,
  FLSpielEditorBericht,
  FLSpielJoinedAdmin,
  FLSpielTeamFieldJoined,
} from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { TableRow } from "@/kit/Table";
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

const { ort, schiedsrichter } = SpielePatchSpielBody.shape;

/** Whether a booking's money is required beside it, read off the write's schema. */
const REQUIRED = {
  mietpreis: !ort.options[0].shape.mietpreis.safeParse(null).success,
  honorar: !schiedsrichter.options[0].shape.payment.safeParse(null).success,
};

/** One read of the editor's whole view, for the tab's title and the page alike. */
const read = cache(getAdminSpiel);

/**
 * The fixture the address names, as every season page reads its record: not-found for a malformed id, for none
 * by it, and for one of another season, the tab's title included.
 */
async function readSpiel(params: Props["params"]): Promise<FLSpieleAdminSingleResponse> {
  const spiel = await resolveObjectIdParam(params, "spiel");
  const { saison } = await params;
  const view = await read(spiel);
  if (view === null || view.spiel.saison_id !== saison) notFound();
  return view;
}

/** A match is named by its two teams, as its own page is, and by its number while a side is still open. */
const nameOf = (spiel: FLSpielJoinedAdmin) =>
  spiel.team1 === null || spiel.team2 === null
    ? WORDS.number(spiel.spiel_nr)
    : ROUTES.adminSpiel.title({ record: spiel.team1.name }, { record: spiel.team2.name });

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { spiel } = await readSpiel(params);
  return pageMetadata(parent, ROUTES.adminSpiel, ROUTES.adminSpiel.path(spiel.saison_id, spiel.id), { title: nameOf(spiel) });
}

/** The match editor, on its one view read. */
export default function SpielEditorPage({ params }: Props) {
  return <EditorShell editor={readEditor(params)} />;
}

/** A pupil a goal names, by the names their record holds; a goal nobody was named for, „unbekannt“. */
function scorerOf(bericht: FLSpielEditorBericht, spielerId: string | null): Words {
  const words = SERVER_COPY.season.spiel;
  if (spielerId === null) return words.unknown;
  const named = bericht.named.find((spieler) => spieler.spieler_id === spielerId);
  if (named === undefined || named.vorname === null) return words.anonymous;
  return { record: named.nachname === null ? named.vorname : `${named.vorname} ${named.nachname}` };
}

/** A minute as the report writes it, „45+2“, in the order it was played. */
const minuteOf = (minute: string): [number, number] => {
  const [base = "0", added = "0"] = minute.split("+");
  return [Number(base), Number(added)];
};

/**
 * The report's goals as rows, read-only, since its referee writes them (D296): each in the order it was scored, the
 * side's plaque before the scorer, and the score the goal made. An own goal counts for the other side.
 */
function berichtRows(spiel: FLSpielJoinedAdmin, bericht: FLSpielEditorBericht): TableRow[] {
  const words = SERVER_COPY.season.spiel;
  const plaques = { team1: spiel.team1?.shorthand ?? null, team2: spiel.team2?.shorthand ?? null };
  const score = { team1: 0, team2: 0 };
  return bericht.torschuetzen
    .map((tor, index) => ({ tor, index }))
    .toSorted((one, other) => {
      const [a, b] = [minuteOf(one.tor.minute), minuteOf(other.tor.minute)];
      return a[0] - b[0] || a[1] - b[1] || one.index - other.index;
    })
    .map(({ tor, index }) => {
      const counts = tor.eigentor ? (tor.seite === "team1" ? "team2" : "team1") : tor.seite;
      score[counts] += 1;
      const plaque = plaques[tor.seite];
      return {
        id: String(index),
        name: scorerOf(bericht, tor.spieler_id),
        ...(plaque === null ? {} : { plaque: { record: plaque } }),
        cells: {
          event: tor.eigentor ? words.eigentor : words.tor,
          minute: { record: tor.minute },
          stand: WORDS.score(score, null),
        },
      };
    });
}

/** The referee's proposal as „Übernehmen“ carries it into the result's fields, where the report stands open to it. */
function adoptionOf(spiel: FLSpielJoinedAdmin, bericht: FLSpielEditorBericht | null): Adoption | null {
  if (bericht === null || (bericht.state !== "vorgeschlagen" && bericht.state !== "differing")) return null;
  const { team1_tore: tore1, team2_tore: tore2, elfmeterschiessen, sonderereignis } = bericht.ergebnis_vorschlag;
  const event = sonderereignis ?? NO_SONDEREREIGNIS;
  // A no-show's goals are the award the write composes: the proposal names the side that stayed away alone.
  if (sonderereignis === "nichtantreten_team1" || sonderereignis === "nichtantreten_team2") {
    const words = ereignisOf({ ...spiel, sonderereignis, ergebnis: null });
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

/** The party's open row about the fixture's Ansetzung as it stands, closed ones being about one it left. */
const openRowOf = (rows: readonly FLSpielbestaetigung[], party: (row: FLSpielbestaetigung) => boolean) =>
  rows.find((row) => row.closed === null && party(row));

/**
 * One party's answer as a row: its name, its answer's chip, and the answer's day, the day it is due by, or that the
 * party has not been asked; a declining club's proposed date and its reason in its own words.
 */
function answerRow(id: string, name: Words, plaque: string | null, row: FLSpielbestaetigung | undefined, declined: Copy): TableRow {
  const shown = { id, name, ...(plaque === null ? {} : { plaque: { record: plaque } }) };
  // One word in one hue, the area's for a state still waiting: the cell beside it says whether the party was asked.
  const open = { tone: "warn", label: COPY.template.open } as const;
  if (row === undefined) return { ...shown, chip: open, cells: { answer: WORDS.notAsked } };
  const { antwort } = row;
  if (antwort === null) return { ...shown, chip: open, cells: { answer: WORDS.answerBy(dayOf(row.frist)) } };
  const cells: Record<string, Words> = {
    answer: antwort.von.art === "admin" ? WORDS.enteredByLeague : { record: formatDatum(dayOf(antwort.am)) },
  };
  if (antwort.art === "zugesagt") return { ...shown, chip: { tone: "success", label: WORDS.zugesagt }, cells };
  if (antwort.vorschlag !== null) cells.proposal = COPY.spielplan.when(dayOf(antwort.vorschlag.datum), timeOf(antwort.vorschlag.uhrzeit));
  if (antwort.begruendung !== null) cells.reason = { record: antwort.begruendung };
  return { ...shown, chip: { tone: "danger", label: declined }, cells };
}

/** Each party's answer about the fixture as it stands: both clubs, then the referee where one is booked. */
function answerRows(view: FLSpieleAdminSingleResponse): TableRow[] {
  const { spiel, spielbestaetigungen: rows } = view;
  const club = (side: "team1" | "team2", team: FLSpielTeamFieldJoined | null) =>
    team === null
      ? []
      : [
          answerRow(
            side,
            { record: team.name },
            team.shorthand,
            openRowOf(rows, (row) => row.party.art === "team" && row.party.team_id === team.team_id),
            WORDS.abgelehnt,
          ),
        ];
  const booked = spiel.schiedsrichter;
  const referee =
    booked === null
      ? []
      : [
          answerRow(
            "schiedsrichter",
            booked.name === null ? COPY.shared.notProvided : { record: booked.name },
            null,
            openRowOf(rows, (row) => row.party.art === "schiedsrichter" && row.party.schiedsrichter_id === booked.schiedsrichter_id),
            WORDS.abgesagt,
          ),
        ];
  return [...club("team1", spiel.team1), ...club("team2", spiel.team2), ...referee];
}

/** A knockout match's clubs for its two sides by hand, each a club the write would not field noted why. */
function clubsOf(view: FLSpieleAdminSingleResponse): Club[] | null {
  return (
    view.teams?.map((team) =>
      team.fieldable
        ? { id: team.id, name: team.name }
        : { id: team.id, name: team.name, note: team.on_spieltag ? WORDS.onSpieltag : WORDS.departed },
    ) ?? null
  );
}

async function readEditor(params: Props["params"]) {
  const view = await readSpiel(params);
  const { spiel: saved } = view;
  // A finished season's matches take no write (`saison_past`), so the editor opens on one read-only.
  const closed = view.saison_status === "past";

  // A no-show needs both sides: while one is open, the write refuses it, so it is offered disabled.
  const bothSides = saved.team1 !== null && saved.team2 !== null;
  const sonderereignisse: Option[] = [
    { id: NO_SONDEREREIGNIS, label: WORDS.none },
    ...Object.values(FLSonderereignis).map((event): Option => {
      const label = SONDEREREIGNISSE[event];
      const open = !bothSides && (event === "nichtantreten_team1" || event === "nichtantreten_team2");
      return open ? { id: event, label, isDisabled: true, note: WORDS.needsBothSides } : { id: event, label };
    }),
  ];

  return (
    <SpielEditor
      title={nameOf(saved)}
      record={{ id: saved.id, version: saved.version, values: valuesOf(saved) }}
      save={saveSpiel}
      preview={previewSpiel}
      phase={saved.saison_phase}
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
            : { id: spielort.id, label: { record: spielort.name }, isDisabled: true, note: COPY.admin.spielort.retired },
        price: spielort.default_mietpreis,
      }))}
      schiedsrichter={view.schiedsrichter.map((person) => ({
        // A referee who has not confirmed their entry is listed, so they read as waiting and never as missing, and is
        // not to be chosen; the match's own retired referee stays listed as its retired venue does.
        option:
          person.inactive_since !== null
            ? { id: person.id, label: { record: person.name }, isDisabled: true, note: COPY.admin.spielort.retired }
            : person.confirmed
              ? { id: person.id, label: { record: person.name } }
              : { id: person.id, label: { record: person.name }, isDisabled: true, note: WORDS.unconfirmed },
        price: person.default_payment,
      }))}
      sonderereignisse={sonderereignisse}
      notizMax={spielePatchSpielBodyNotizOneMax}
      required={REQUIRED}
      report={view.spielbericht === null ? [] : berichtRows(saved, view.spielbericht)}
      adoption={adoptionOf(saved, view.spielbericht)}
      answers={answerRows(view)}
      createSpielort={createSpielort}
      spielortRules={SPIELORT_RULES}
      {...(closed ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
    />
  );
}
