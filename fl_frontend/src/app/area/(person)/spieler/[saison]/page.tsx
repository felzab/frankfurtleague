import { notFound } from "next/navigation";

import { ReadPage } from "@/kit/ReadPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { getOwnSaisons } from "@/features/roles/queries";
import { requireRole } from "@/features/roles/resolvers";
import { matchdayOf, matchRowOf } from "@/features/spiele/blocks";
import { getSpielerSaisonSelf } from "@/features/spieler/queries";
import { rowChip } from "@/features/spieler/rowChip";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { spielChipOf } from "./spielChip";

import type { FLSpielerSelfKaderRow } from "@/core/generated/client/types";
import type { ReadContent, ReadWait } from "@/kit/ReadPage";
import type { StatTile } from "@/kit/StatTiles";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/spieler/[saison]">;

const WORDS = COPY.admin.spieler;

/**
 * The season of the address where the pupil's own records stand in it, else `null`; a person holding no pupil's
 * Funktion is sent on before. The seasons are the frame's own read, so judging the address costs no request.
 */
async function ownSaison(params: Props["params"]): Promise<string | null> {
  const { saison } = await params;
  await requireRole("spieler", ROUTES.spielerOverview.path(saison));
  const saisons = await getOwnSaisons("spieler");
  return saisons?.entries.some((entry) => entry.id === saison) === true ? saison : null;
}

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(ownSaison(params), (saison) => pageMetadata(parent, ROUTES.spielerOverview, ROUTES.spielerOverview.path(saison)));
}

/** A fact of the squad row, the empty mark while the row holds none. */
const factOf = (value: string | null) => (value === null ? COPY.shared.noValue : { record: value });

/**
 * Where the pupil plays in the season shown: their club, a link to its page, with the squad row's chip after it, and
 * their Nummer, Position and Stufe.
 */
function tilesOf(saison: string, kader: FLSpielerSelfKaderRow): readonly [StatTile, StatTile, StatTile, StatTile] {
  const chip = rowChip(kader);
  return [
    {
      label: COPY.shared.facts.team,
      value: { record: kader.team_name },
      words: true,
      href: ROUTES.team.path(saison, kader.team_id),
      ...(chip === undefined ? {} : { chip }),
    },
    { label: WORDS.nummer, value: factOf(kader.nummer) },
    { label: WORDS.position, value: factOf(kader.position), words: true },
    { label: WORDS.stufe, value: factOf(kader.stufe), words: true },
  ];
}

/** The pupil's own season, read once: a season their records do not stand in is no page of theirs. */
async function readSaison(params: Props["params"]): Promise<ReadContent> {
  const saison = await ownSaison(params);
  if (saison === null) notFound();
  const { kader, spiele } = await getSpielerSaisonSelf(saison);
  if (kader === null) notFound();
  const deregistered = kader.inactive_since !== null;
  return {
    groups: [
      { kind: "tiles", tiles: { layout: "four", items: tilesOf(saison, kader) } },
      {
        title: COPY.page.spiele,
        kind: "spiele",
        spiele: spiele.map((spiel) => {
          const chip = spielChipOf(spiel, deregistered);
          return { head: matchdayOf(spiel, spiel), spiel: { ...matchRowOf(spiel), ...(chip === undefined ? {} : { chip }) } };
        }),
        empty: { kind: "none", plural: COPY.page.spiele, glyph: "spielplan" },
      },
    ],
  };
}

/** The board's wait: the four tiles, none with a line under its value, and two match cards. */
const WAIT: ReadWait = {
  groups: [
    { kind: "tiles", layout: "four", line: false },
    { title: COPY.page.spiele, kind: "spiele", count: 2 },
  ],
};

/**
 * A pupil's own Übersicht of one season: where they play, as four tiles, and their club's matches, each under its
 * matchday with the pupil's place in the line-up. Another season is the frame's season button's; the page has no act,
 * since what a pupil may change, their consent and their data, is Konto's.
 */
export default function SpielerOverviewPage({ params }: Props) {
  return (
    <ReadPage
      scope="area"
      title={{ route: "spielerOverview" }}
      width="content"
      wait={WAIT}
      record={readSaison(params)}
    />
  );
}
