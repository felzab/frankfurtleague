import { cache } from "react";
import { notFound } from "next/navigation";

import { ReadPage } from "@/kit/ReadPage";

import { COPY } from "@/core/copy";
import { ROUTES } from "@/core/routes";
import { readAsRoleHolder } from "@/features/roles/resolvers";
import { isPublicSaison } from "@/features/saisons/resolvers";
import { headedMatchOf } from "@/features/spiele/blocks";
import { getSpielerSaisonSelf } from "@/features/spieler/queries";
import { rowChip } from "@/features/spieler/rowChip";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import { isOwnSaison } from "../../ownSaison";
import { spielChipOf } from "./spielChip";

import type { FLSpielerSelfKaderRow } from "@/core/generated/client/types";
import type { ReadContent, ReadWait } from "@/kit/ReadPage";
import type { StatTile } from "@/kit/StatTiles";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/area/spieler/[saison]">;

const WORDS = COPY.admin.spieler;

/**
 * The pupil's own season, read once for the tab's title and the page alike: `null` for a season none of their records
 * stands in, which the frame's own read judges at no request of its own, and for one whose read holds no squad row of
 * theirs. A person holding no pupil's Funktion is sent on before anything is read.
 */
const saisonOf = cache(async (saison: string) => {
  if (!(await isOwnSaison("spieler", saison))) return null;
  const { kader, spiele } = await readAsRoleHolder("spieler", () => getSpielerSaisonSelf(saison));
  return kader === null ? null : { kader, spiele };
});

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(saisonOf(saison), () => pageMetadata(parent, ROUTES.spielerOverview, ROUTES.spielerOverview.path(saison)));
}

/** A fact of the squad row, the empty mark while the row holds none. */
const factOf = (value: string | null) => (value === null ? COPY.shared.noValue : { record: value });

/**
 * Where the pupil plays in the season shown: their club, a link to its page where the public may read the season, with
 * the squad row's chip after it, and their Nummer, Position and Stufe.
 */
function tilesOf(saison: string, kader: FLSpielerSelfKaderRow, isPublic: boolean): readonly [StatTile, StatTile, StatTile, StatTile] {
  const chip = rowChip(kader);
  return [
    {
      label: COPY.shared.facts.team,
      value: { record: kader.team_name },
      words: true,
      // A planned season's club page answers not found to everyone, its own pupils included.
      ...(isPublic ? { href: ROUTES.team.path(saison, kader.team_id) } : {}),
      ...(chip === undefined ? {} : { chip }),
    },
    { label: WORDS.nummer, value: factOf(kader.nummer) },
    { label: WORDS.position, value: factOf(kader.position), words: true },
    { label: WORDS.stufe, value: kader.stufe === null ? COPY.shared.noValue : COPY.admin.saison.stufe[kader.stufe], words: true },
  ];
}

/** Their club's matches, none of which there are while the pupil's records stand in no season. */
const SPIELE = { title: COPY.page.spiele, kind: "spiele", empty: { kind: "none", plural: COPY.page.spiele, glyph: "spielplan" } } as const;

/**
 * The pupil's own season: a season their records do not stand in is no page of theirs, and where they stand in none
 * the page holds their matches' group alone, with none in it.
 */
async function readSaison(of: Promise<string | null>): Promise<ReadContent> {
  const saison = await of;
  if (saison === null) return { groups: [{ ...SPIELE, spiele: [] }] };
  const read = await saisonOf(saison);
  if (read === null) notFound();
  const { kader, spiele } = read;
  const deregistered = kader.inactive_since !== null;
  const isPublic = await isPublicSaison(saison);
  return {
    groups: [
      { kind: "tiles", tiles: { layout: "four", items: tilesOf(saison, kader, isPublic) } },
      {
        ...SPIELE,
        spiele: spiele.map((spiel) => {
          const chip = spielChipOf(spiel, deregistered);
          const { head, spiel: row } = headedMatchOf(spiel, isPublic);
          return { head, spiel: { ...row, ...(chip === undefined ? {} : { chip }) } };
        }),
      },
    ],
  };
}

/** The wait: the four tiles, none with a line under its value, and two match cards. */
const WAIT: ReadWait = {
  groups: [
    { kind: "tiles", layout: "four", line: false },
    { title: COPY.page.spiele, kind: "spiele", count: 2 },
  ],
};

/**
 * A pupil's own Übersicht of one season: where they play, as four tiles, and their club's matches, each under its
 * matchday with the pupil's place in the line-up. Another season is the frame's season button's; the page has no act,
 * since what a pupil may change, their consent and their data, is Konto's. Drawn for the season the address names,
 * and at `/area/spieler` for the season the frame takes by standard.
 */
export function SpielerOverview({ saison }: { saison: Promise<string | null> }) {
  return (
    <ReadPage
      scope="area"
      title={{ route: "spielerOverview" }}
      width="content"
      wait={WAIT}
      record={readSaison(saison)}
    />
  );
}

export default function SpielerOverviewPage({ params }: Props) {
  return <SpielerOverview saison={params.then(({ saison }) => saison)} />;
}
