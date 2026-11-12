import { cache } from "react";
import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";
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
import { matchName } from "@/features/spiele/blocks";
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
 * The row's standing, the first that holds: a game called off and the referee's own decline end the booking; a
 * booking still to answer before its kick-off carries the two answers; then the report, stored or owed once the game
 * takes one; then an agreement, the league's marked as entered for them; then a booking that lapsed unanswered. A
 * booking the league is to ask again, or never asked, carries no chip.
 */
function standingOf(spiel: FLSchiedsrichterSpiel): Standing {
  if (spiel.state === "cancelled") return { chip: { tone: "danger", label: SPIEL.cancelled } };
  if (spiel.state === "declined") {
    return { chip: { tone: "danger", label: SPIEL.declined }, ...(spiel.reason === null ? {} : { adds: { record: spiel.reason } }) };
  }
  if (spiel.state === "valid" && !spiel.past) {
    return { chip: { tone: "warn", label: SERVER_COPY.overview.missing(COPY.area.answer) }, open: true };
  }
  if (spiel.submitted_at !== null) return { chip: { tone: "success", label: COPY.area.schiedsrichter.reported } };
  if (spiel.reportable) return { chip: { tone: "warn", label: SERVER_COPY.overview.missing(SPIEL.spielbericht) } };
  if (spiel.state === "agreed") {
    return { chip: { tone: "success", label: SPIEL.zugesagt }, ...(spiel.entered ? { adds: SPIEL.enteredByLeague } : {}) };
  }
  if (spiel.state === "expired") return { chip: { tone: "neutral", label: COPY.admin.expired } };
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
async function readSpiele(params: Props["params"]) {
  const { saison } = await params;
  const read = await spieleOf(saison);
  if (read === null) notFound();
  return {
    cards: [
      {
        id: "spiele",
        title: TITLE,
        rows: read.spiele.map((spiel) => rowOf(spiel, saison)),
        count: false as const,
        empty: { kind: "none" as const, plural: TITLE, glyph: "spielplan" as const },
      },
    ],
  };
}

/**
 * A referee's Übersicht of one season: one box „Spiele“, searched on the page, a row a game in the order the read gives,
 * open work first, then the games to come, then the finished. A booking is answered on its row, and every row opens its
 * game's match report.
 */
export default function SchiedsrichterOverviewPage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "area", title: { route: "schiedsrichterOverview" } }}
      list={{
        kind: "cards",
        search: { label: COPY.area.schiedsrichter.search },
        // A rail page's wait draws its taller state (`kit/Skeleton.tsx`): every row with its two acts' bars, which a
        // row without acts lands a line shorter than on a phone, collapsing unseen under `main`.
        wait: { rows: 5, cards: [{ title: TITLE, acts: [COPY.shared.verb.agree, COPY.shared.verb.decline], count: false }] },
        content: readSpiele(params),
      }}
    />
  );
}
