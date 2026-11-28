import { cache } from "react";
import { notFound } from "next/navigation";

import { boxRulesOf } from "@/core/action";
import { AREA_COPY } from "@/core/copy/area";
import { COPY } from "@/core/copy/shared";
import { refusedAs } from "@/core/errors";
import { dayOf, timeOf } from "@/core/format";
import { CustomObjectIdStringSchema } from "@/core/objectId";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { readAsRoleHolder, requireRole } from "@/features/roles/resolvers";
import { isPublicSaison } from "@/features/saisons/resolvers";
import { getOwnSpielbericht } from "@/features/spielberichte/queries";
import { eventChipOf, matchName, matchTitle } from "@/features/spiele/blocks";
import { spielerName } from "@/features/spieler/constants";
import { StatusPage } from "@/kit/StatusPage";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { BerichtEditor } from "./BerichtEditor";
import { valuesOf } from "./berichtValues";
import { saveBericht } from "./saveBericht";

import type { Copy } from "@/core/copy";
import type { Code, FLSpielberichtSchiedsrichterResponse, FLSpielberichtSpieler, FLSpielSide } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { Metadata } from "next";

type Props = PageProps<"/area/schiedsrichter/[saison]/spielbericht/[spiel]">;

type Segments = { saison: string; spiel: string };

const WORDS = AREA_COPY.schiedsrichter.spielbericht;

const address = ({ saison, spiel }: Segments) => ROUTES.schiedsrichterSpielbericht.path(saison, spiel);

/** The refusal of a report's read to a referee the fixture does not have. */
const UNBOOKED: ReadonlySet<Code> = new Set<Code>(["bericht_not_officiated"]);

/**
 * What the address holds for the signed-in referee: the report's read, or `unbooked` for a fixture booked to another
 * referee or one a club's exit took them off, whose read is refused; `null` for a malformed id, a fixture that does not
 * exist and one of another season. A referee whose record went between the frame's check and the read is sent on as
 * every person place sends them.
 */
const find = cache(async (saison: string, spiel: string): Promise<FLSpielberichtSchiedsrichterResponse | "unbooked" | null> => {
  await requireRole("schiedsrichter", address({ saison, spiel }));
  const id = CustomObjectIdStringSchema.safeParse(spiel);
  if (!id.success) return null;
  try {
    const read = await readAsRoleHolder("schiedsrichter", () => getOwnSpielbericht(id.data));
    return read === null || read.spiel.saison_id !== saison ? null : read;
  } catch (error) {
    if (refusedAs(error, UNBOOKED)) return "unbooked";
    throw error;
  }
});

const findIn = async (params: Props["params"]) => {
  const { saison, spiel } = await params;
  return find(saison, spiel);
};

/** The match by its two teams, as its own page is titled. */
const titleOf = ({ spiel }: FLSpielberichtSchiedsrichterResponse): PageTitle =>
  matchTitle(spiel.team1?.name ?? null, spiel.team2?.name ?? null);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(findIn(params), async (found) =>
    pageMetadata(ROUTES.schiedsrichterSpielbericht, address(await params), {
      title: found === "unbooked" ? COPY.spielplan.spielbericht : matchName(found.spiel.team1?.name ?? null, found.spiel.team2?.name ?? null),
    }),
  );
}

/** A pupil by number and name as the squad lists them; one no record holds is „anonym“, as every page names them. */
function optionOf({ spieler_id: id, nummer, first_name: first, last_name: last }: FLSpielberichtSpieler): Option {
  const name = spielerName({ first_name: first, last_name: last });
  return { id, label: { record: COPY.shared.line([nummer === null ? null : { record: nummer }, name]) } };
}

/**
 * Each side's pupils to pick from: its live squad, then any pupil a stored row names on that side outside it, kept so
 * the row shows its name and not to be picked anew, which the write refuses. A side fielding another club since the
 * report was written offers its squad alone: its rows naming a pupil outside it have lost their player, and the
 * departed club's pupils are no deregistration of the club playing.
 */
function kaderOf(read: FLSpielberichtSchiedsrichterResponse): Record<FLSpielSide, Option[]> {
  const stored = read.bericht;
  const sideOf = (side: FLSpielSide): Option[] => {
    if (read.sides_changed.includes(side)) return read.kader[side].map(optionOf);
    const named = new Set(
      [...(stored?.scorers ?? []), ...(stored?.cards ?? [])].filter((row) => row.side === side).map((row) => row.spieler_id),
    );
    const kept = read.named
      .filter((spieler) => named.has(spieler.spieler_id) && !read.kader[side].some((own) => own.spieler_id === spieler.spieler_id))
      .map((spieler): Option => ({ ...optionOf(spieler), isDisabled: true, note: COPY.kader.deregistered }));
    return [...read.kader[side].map(optionOf), ...kept];
  };
  return { team1: sideOf("team1"), team2: sideOf("team2") };
}

/** A status card in the editor's frame, under the strip's title, leading back to the referee's season. */
function card(title: PageTitle, tone: "info" | "warn" | "danger", said: Copy, saison: string) {
  return (
    <StatusPage
      scope="area"
      title={title}
      card={{ tone, title: said, next: { label: COPY.shared.end.toOverview, href: ROUTES.schiedsrichterOverview.path(saison) } }}
    />
  );
}

/** The report's form, on its one read, or the status card saying why the fixture takes no report from this referee. */
export default async function SpielberichtPage({ params }: Props) {
  const { saison } = await params;
  const found = await findIn(params);
  if (found === null) notFound();
  if (found === "unbooked") return card(COPY.spielplan.spielbericht, "warn", SERVER_COPY.area.schiedsrichter.unbooked, saison);

  const { spiel } = found;
  const title = titleOf(found);
  // A finished season's stored report is read, never written (`saison_past`), whatever became of its fixture since.
  if (!found.completed || found.bericht === null) {
    // The write's own refusals a page can foresee from the fixture it serves, stated before any press meets them, and
    // after the season the reason its fixture took no report.
    if (spiel.sonderereignis === "ausgefallen" || spiel.sonderereignis === "annulliert") {
      return card(title, "danger", WORDS.befell[spiel.sonderereignis], saison);
    }
    const day = dayOf(spiel.date);
    if (day === null) return card(title, "info", COPY.spielplan.when(null, null), saison);
    // A finished season's form takes no report, so one never written has nothing to show.
    if (found.completed) return card(title, "info", SERVER_COPY.area.schiedsrichter.unreported, saison);
    // The backend judges the kick-off on Germany's clock, as the write's `bericht_not_played` does.
    if (!found.reportable) {
      return card(title, "info", SERVER_COPY.area.schiedsrichter.spielberichtFrom(COPY.spielplan.when(day, timeOf(spiel.time))), saison);
    }
  }

  // The form tells its two sides apart, so a side the knockout has not settled goes by its place, never „Noch offen“ twice.
  const sideOf = (side: FLSpielSide) => {
    const team = found.spiel[side];
    return team === null
      ? { name: COPY.shared.teamPair[side], plaque: null }
      : { name: { record: team.name }, plaque: { record: team.shorthand } };
  };

  return (
    <BerichtEditor
      title={title}
      // What befell the match, as every match block draws it.
      {...(spiel.sonderereignis === null
        ? {}
        : { chip: eventChipOf(spiel.sonderereignis, spiel.team1?.name ?? null, spiel.team2?.name ?? null) })}
      lead={COPY.shared.line([
        COPY.spielplan.when(dayOf(spiel.date), timeOf(spiel.time)),
        spiel.spielort === null ? null : { record: spiel.spielort.name },
        // A side fielding another club than the stored report names: its rows naming the old club's pupils have lost them.
        found.sides_changed.length === 0 ? null : SERVER_COPY.overview.report.sides_changed,
      ])}
      record={{ id: spiel.spiel_id, version: found.version, values: valuesOf(found) }}
      save={saveBericht}
      phase={spiel.saison_phase}
      sides={{ team1: sideOf("team1"), team2: sideOf("team2") }}
      kader={kaderOf(found)}
      rules={boxRulesOf(saveBericht)}
      eigentor={SERVER_COPY.season.spiel.eigentor}
      {...(found.completed ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
      {...((await isPublicSaison(saison)) ? { spielPage: ROUTES.spiel.path(saison, spiel.spiel_id) } : {})}
    />
  );
}
