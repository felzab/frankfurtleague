import { cache } from "react";
import { notFound } from "next/navigation";

import { EditorShell } from "@/kit/EditorShell";
import { RecordRowsPlaceholder } from "@/kit/RecordRows";
import { SectionPlaceholder } from "@/kit/Section";
import { StatusPage } from "@/kit/StatusPage";

import { requires } from "@/core/action";
import { COPY } from "@/core/copy";
import { APIBadStatusError } from "@/core/errors";
import { dayOf, timeOf } from "@/core/format";
import {
  spielberichtePutSpielberichtBerichtBodyBerichtRemarksOneMax,
  spielberichtePutSpielberichtBerichtBodyBerichtScorersItemMinuteRegExp,
} from "@/core/generated/zod/inputs";
import { CustomObjectIdStringSchema } from "@/core/objectId";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { readAsRoleHolder, requireRole } from "@/features/roles/resolvers";
import { isPublicSaison } from "@/features/saisons/resolvers";
import { getOwnSpielbericht } from "@/features/spielberichte/queries";
import { eventChipOf, matchName, matchTitle } from "@/features/spiele/blocks";
import { spielerName } from "@/features/spieler/constants";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { BerichtEditor } from "./BerichtEditor";
import { Card, Goal } from "./berichtRules";
import { valuesOf } from "./berichtValues";
import { saveBericht } from "./saveBericht";

import type { Copy } from "@/core/copy";
import type { FLSpielberichtSchiedsrichterResponse, FLSpielberichtSpieler, FLSpielSide } from "@/core/generated/client/types";
import type { Option } from "@/kit/OptionList";
import type { PageTitle } from "@/kit/RailFrame";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/schiedsrichter/[saison]/spielbericht/[spiel]">;

type Segments = { saison: string; spiel: string };

const WORDS = COPY.area.schiedsrichter.spielbericht;

/** Whether a row's minute and each list's player are required, read off the rules the save holds them to. */
const REQUIRED = {
  minute: requires(Goal.shape.minute, ""),
  goalPlayer: requires(Goal.shape.spieler_id, null),
  cardPlayer: requires(Card.shape.spieler_id, null),
  // One cell chooses a goal's side and a card's, held to the same rule.
  side: requires(Goal.shape.side, null) && requires(Card.shape.side, null),
  cardColour: requires(Card.shape.colour, null),
};

/** The page's own address, which a session sent to sign in comes back to. */
const address = ({ saison, spiel }: Segments) => ROUTES.schiedsrichterSpielbericht.path(saison, spiel);

/**
 * What the address holds for the signed-in referee: the report's read, or `unbooked` for a fixture booked to another
 * referee, whose read is refused; `null` for a malformed id, a fixture that does not exist and one of another season.
 * A referee whose record went between the frame's check and the read is sent on as every person place sends them.
 * Memoised for the render, so the tab's title and the page share the one read.
 */
const find = cache(async (saison: string, spiel: string): Promise<FLSpielberichtSchiedsrichterResponse | "unbooked" | null> => {
  await requireRole("schiedsrichter", address({ saison, spiel }));
  const id = CustomObjectIdStringSchema.safeParse(spiel);
  if (!id.success) return null;
  try {
    const read = await readAsRoleHolder("schiedsrichter", () => getOwnSpielbericht(id.data));
    return read === null || read.spiel.saison_id !== saison ? null : read;
  } catch (error) {
    if (error instanceof APIBadStatusError && error.serverErrorCode === "bericht_not_officiated") return "unbooked";
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

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(findIn(params), async (found) =>
    pageMetadata(parent, ROUTES.schiedsrichterSpielbericht, address(await params), {
      title: found === "unbooked" ? COPY.admin.spiel.spielbericht : matchName(found.spiel.team1?.name ?? null, found.spiel.team2?.name ?? null),
    }),
  );
}

/** The report's form, on its one read, or the status card saying why the fixture takes no report from this referee. */
export default function SpielberichtPage({ params }: Props) {
  return (
    <EditorShell
      wait={{
        lead: true,
        // A public season's match, the report's state most days, links its page from the strip.
        link: COPY.shared.toSpiel,
        sections: [
          ["score", "rule", "field"],
          {
            block: (
              <SectionPlaceholder
                list={
                  <RecordRowsPlaceholder
                    rows={3}
                    lines={2}
                    add={COPY.shared.withObject(WORDS.goal, "enter")}
                  />
                }
              />
            ),
          },
          {
            block: (
              <SectionPlaceholder
                list={
                  <RecordRowsPlaceholder
                    rows={1}
                    lines={3}
                    add={COPY.shared.withObject(WORDS.card, "enter")}
                  />
                }
              />
            ),
          },
          [{ titled: "paragraph" }],
        ],
      }}
      editor={readPage(params)}
    />
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
function squadsOf(read: FLSpielberichtSchiedsrichterResponse): Record<FLSpielSide, Option[]> {
  const stored = read.bericht;
  const sideOf = (side: FLSpielSide): Option[] => {
    if (read.sides_changed.includes(side)) return read.kader[side].map(optionOf);
    const named = new Set(
      [...(stored?.scorers ?? []), ...(stored?.cards ?? [])].filter((row) => row.side === side).map((row) => row.spieler_id),
    );
    const kept = read.named
      .filter((spieler) => named.has(spieler.spieler_id) && !read.kader[side].some((own) => own.spieler_id === spieler.spieler_id))
      .map((spieler): Option => ({ ...optionOf(spieler), isDisabled: true, note: COPY.admin.spieler.deregistered }));
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

async function readPage(params: Props["params"]) {
  const { saison } = await params;
  const found = await findIn(params);
  if (found === null) notFound();
  if (found === "unbooked") return card(COPY.admin.spiel.spielbericht, "warn", SERVER_COPY.area.schiedsrichter.unbooked, saison);

  const { spiel } = found;
  const title = titleOf(found);
  // A finished season's report is read, never written (`saison_past`), whatever became of its fixture since.
  if (!found.completed) {
    // The write's own refusals a page can foresee from the fixture it serves, stated before any press meets them.
    if (spiel.sonderereignis === "ausgefallen" || spiel.sonderereignis === "annulliert") {
      return card(title, "danger", WORDS.befell[spiel.sonderereignis], saison);
    }
    const day = dayOf(spiel.date);
    if (day === null) return card(title, "info", COPY.spielplan.when(null, null), saison);
    // The backend judges the kick-off on Germany's clock, as the write's `bericht_not_played` does.
    if (!found.reportable) {
      return card(title, "info", SERVER_COPY.area.schiedsrichter.spielberichtFrom(COPY.spielplan.when(day, timeOf(spiel.time))), saison);
    }
  }

  // The form tells its two sides apart, so a side the knockout has not settled goes by its place, never „Noch offen“ twice.
  const sideOf = (side: FLSpielSide) => {
    const team = found.spiel[side];
    return team === null ? { name: COPY.admin.spiel[side], plaque: null } : { name: { record: team.name }, plaque: { record: team.shorthand } };
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
      squads={squadsOf(found)}
      minute={{ pattern: spielberichtePutSpielberichtBerichtBodyBerichtScorersItemMinuteRegExp.source }}
      required={REQUIRED}
      eigentor={SERVER_COPY.season.spiel.eigentor}
      remarksMax={spielberichtePutSpielberichtBerichtBodyBerichtRemarksOneMax}
      {...(found.completed ? { closed: SERVER_COPY.refusalLine.saison_past } : {})}
      {...((await isPublicSaison(saison)) ? { spielPage: ROUTES.spiel.path(saison, spiel.spiel_id) } : {})}
    />
  );
}
