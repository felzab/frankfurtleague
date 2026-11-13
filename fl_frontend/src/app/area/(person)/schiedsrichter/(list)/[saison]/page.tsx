import { cache } from "react";
import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";
import { AGREED_CHIP, DECLINED_CHIP, EXPIRED_CHIP } from "@/kit/stateChips";
import { TextField } from "@/kit/TextField";

import { requires } from "@/core/action";
import { COPY, textOf } from "@/core/copy";
import { dayOf, formatDate, timeOf } from "@/core/format";
import {
  SpielbestaetigungenPostSchiedsrichterAnswerBody,
  spielbestaetigungenPostSchiedsrichterAnswerBodyReasonOneMax,
} from "@/core/generated/zod/inputs";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { readAsRoleHolder } from "@/features/roles/resolvers";
import { getOwnSpiele } from "@/features/schiedsrichter/queries";
import { eventChipOf, matchName } from "@/features/spiele/blocks";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { isOwnSaison } from "../../../ownSaison";
import { EinteilungActs } from "./EinteilungActs";

import type { Copy, Words } from "@/core/copy";
import type { FLSchiedsrichterSpiel } from "@/core/generated/client/types";
import type { CardActRowProps } from "@/kit/Card";
import type { ChipProps } from "@/kit/Chip";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/schiedsrichter/[saison]">;

const SPIEL = COPY.admin.spiel;
const TITLE = COPY.page.spiele;

/**
 * The signed-in referee's games of the address's season, `null` for a season none of their bookings stands in: one
 * read for the tab's title and the page alike. A person holding no referee record is sent on before anything is read.
 */
const spieleOf = cache(async (saison: string) => {
  if (!(await isOwnSaison("schiedsrichter", saison))) return null;
  return readAsRoleHolder("schiedsrichter", () => getOwnSpiele(saison));
});

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(spieleOf(saison), () => pageMetadata(parent, ROUTES.schiedsrichterOverview, ROUTES.schiedsrichterOverview.path(saison)));
}

/** What a row says of where the game stands for the referee: its chip, and what its line adds after the slot and ground. */
type Standing = { chip?: ChipProps; adds?: Words; open?: true };

/**
 * The row's standing, the first that holds: a report owed, as the read sorts the game among the open work, whatever
 * else the row holds, an event or a booking the league made again past a decline or a call-off; what befell the game,
 * in the event's own word, as every list of matches shows it; a booking a call-off ended since reinstated carries none;
 * the referee's own decline ends the booking; a booking still to answer before its kick-off carries the two answers;
 * then the report stored; then an agreement, the league's marked as entered for them; then a booking that lapsed
 * unanswered. A booking the league is to ask again, or never asked, carries no chip.
 */
function standingOf(spiel: FLSchiedsrichterSpiel): Standing {
  if (spiel.bericht_owed) return { chip: { tone: "warn", label: SERVER_COPY.overview.missing(SPIEL.spielbericht) } };
  if (spiel.sonderereignis !== null) return { chip: eventChipOf(spiel.sonderereignis, spiel.team1_name, spiel.team2_name) };
  if (spiel.state === "cancelled") return {};
  if (spiel.state === "declined") {
    return { chip: DECLINED_CHIP, ...(spiel.reason === null ? {} : { adds: { record: spiel.reason } }) };
  }
  if (spiel.state === "valid" && !spiel.past) {
    return { chip: { tone: "warn", label: SERVER_COPY.overview.missing(COPY.area.answer) }, open: true };
  }
  if (spiel.submitted_at !== null) return { chip: { tone: "success", label: COPY.area.schiedsrichter.reported } };
  if (spiel.state === "agreed") {
    return { chip: AGREED_CHIP, ...(spiel.entered ? { adds: SPIEL.enteredByLeague } : {}) };
  }
  if (spiel.state === "expired") return { chip: EXPIRED_CHIP };
  return {};
}

/** The reason's box of „Einteilung ablehnen“, drawn here so the write's schema stays on the server. */
function ReasonField() {
  return (
    <TextField
      label={COPY.admin.overview.reason}
      // The name `declineEinteilung` reads the reason by.
      name="reason"
      kind="paragraph"
      isRequired={requires(SpielbestaetigungenPostSchiedsrichterAnswerBody.shape.reason, "")}
      maxLength={spielbestaetigungenPostSchiedsrichterAnswerBodyReasonOneMax}
      description={COPY.admin.noNames}
    />
  );
}

/**
 * What the typed text finds a game by, as the Spielsuche finds a match: both clubs, or that a side is still open; its
 * ground; its date as its row shows it and as a reader writes it.
 */
function wordsOf(spiel: FLSchiedsrichterSpiel, name: Copy, when: Copy): string {
  return [textOf(name), spiel.spielort?.name, textOf(when), spiel.date === null ? null : formatDate(dayOf(spiel.date))]
    .filter((word) => word != null)
    .join(" ");
}

/** One game's row: it opens the game's match report, and a booking still to answer carries the two answers. */
function rowOf(spiel: FLSchiedsrichterSpiel, saison: string): CardActRowProps & { id: string; words: string } {
  const { chip, adds, open } = standingOf(spiel);
  const name = matchName(spiel.team1_name, spiel.team2_name);
  const when = COPY.spielplan.when(dayOf(spiel.date), timeOf(spiel.time));
  const id = spiel.spielbestaetigung_id;
  return {
    id: spiel.spiel_id,
    href: ROUTES.schiedsrichterSpielbericht.path(saison, spiel.spiel_id),
    name,
    words: wordsOf(spiel, name, when),
    ...(chip === undefined ? {} : { chip }),
    line: COPY.shared.line([when, spiel.spielort === null ? null : { record: spiel.spielort.name }, adds ?? null]),
    ...(open === true && id !== null
      ? {
          acts: (
            <EinteilungActs
              id={id}
              spiel={name}>
              <ReasonField />
            </EinteilungActs>
          ),
        }
      : {}),
  };
}

/** The referee's games of the season, read once: not-found for a season none of their bookings stands in. */
async function rowsIn(saison: string) {
  const read = await spieleOf(saison);
  if (read === null) notFound();
  return read.spiele.map((spiel) => rowOf(spiel, saison));
}

/** The page's one card, with no game in it while the referee stands in no season, booked to none yet. */
async function readSpiele(of: Promise<string | null>) {
  const saison = await of;
  return {
    cards: [
      {
        id: "spiele",
        title: TITLE,
        rows: saison === null ? [] : await rowsIn(saison),
        count: false as const,
        empty: { kind: "none" as const, plural: TITLE, glyph: "spielplan" as const },
      },
    ],
  };
}

/**
 * A referee's Übersicht of one season: one box „Spiele“, searched on the page, a row a game in the order the read gives,
 * open work first, then the games to come, then the finished. A booking is answered on its row, and every row opens its
 * game's match report. Drawn for the season the address names, and at `/area/schiedsrichter` for the season the frame
 * takes by standard.
 */
export function SchiedsrichterOverview({ saison }: { saison: Promise<string | null> }) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "schiedsrichterOverview" } }}
      list={{
        kind: "cards",
        search: { label: COPY.area.schiedsrichter.search },
        content: readSpiele(saison),
      }}
    />
  );
}

export default function SchiedsrichterOverviewPage({ params }: Props) {
  return <SchiedsrichterOverview saison={params.then(({ saison }) => saison)} />;
}
