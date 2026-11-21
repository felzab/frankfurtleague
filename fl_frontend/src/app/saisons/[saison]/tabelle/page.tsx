import { notFound } from "next/navigation";

import { COPY } from "@/core/copy/shared";
import { formatErgebnis, formatNumber, formatSigned } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getTabelle } from "@/features/saisons/queries";
import { publicSaisonOf, resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { austrittChip } from "@/features/teams/constants";
import { Card } from "@/kit/Card";
import { EmptyBox } from "@/kit/EmptyState";
import { ListPage } from "@/kit/ListPage";
import { TableStanding } from "@/kit/TableStanding";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { FLTabelleRow } from "@/core/generated/client/types";
import type { TableStandingHead, TableStandingProps, TableStandingRow } from "@/kit/TableStanding";
import type { Metadata } from "next";

type Props = PageProps<"/saisons/[saison]/tabelle">;

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return metadataFor(publicSaisonOf(params), (saison) =>
    pageMetadata(ROUTES.tabelle, ROUTES.tabelle.path(saison), { description: SERVER_COPY.description.tabelle(saison) }),
  );
}

/**
 * The Tabelle: each group a card, its head naming the group over its standing. On a phone a club is its plaque
 * alone, its won, drawn and lost counts one coloured „S-U-N“ column, and the difference left out where „Tore“
 * shows both counts.
 */
export default function TabellePage({ params }: Props) {
  return (
    <ListPage
      head={{ scope: "saison", title: { route: "tabelle" } }}
      list={{ kind: "drawn", content: readGroups(params) }}
    />
  );
}

const { column } = SERVER_COPY.season;

const COLUMNS: TableStandingProps["columns"] = [
  { key: "spiele", label: column.spiele, width: "marked" },
  { key: "siege", label: column.siege, phone: "hidden", width: "count" },
  { key: "unentschieden", label: column.unentschieden, phone: "hidden", width: "count" },
  { key: "niederlagen", label: column.niederlagen, phone: "hidden", width: "count" },
  { key: "record", label: column.record, phone: "only", width: "pair" },
  { key: "tore", label: column.tore, width: "pair" },
  { key: "differenz", label: column.differenz, phone: "hidden" },
  { key: "punkte", label: column.punkte, strong: true },
];

/** Every group's table's head, over each group's rows. */
const HEAD: TableStandingHead = {
  rankLabel: column.platz,
  nameLabel: column.team,
  columns: COLUMNS,
};

/**
 * One club's row: its place as the backend numbers it, level clubs sharing one and a club that has played no
 * match holding none; the bar while its place qualifies, grey while level clubs share it; muted once it has left
 * the season, with its exit chip; the matches it played carrying the mark of those called off.
 */
function rowOf(saison: string, row: FLTabelleRow, qualifiers: number, rows: readonly FLTabelleRow[]): TableStandingRow {
  const { statistik } = row;
  const played = { record: formatNumber(statistik.count_played_spiele) };
  const qualifying = row.platz !== null && row.platz <= qualifiers;
  // Level clubs share their place, and the bracket seeds none of them until the tie resolves.
  const level = rows.some((other) => other.id !== row.id && other.platz === row.platz);
  return {
    id: row.id,
    name: { record: row.name },
    href: ROUTES.team.path(saison, row.id),
    plaque: { record: row.shorthand },
    place: row.platz,
    ...(qualifying ? { qualifies: level ? "level" : "settled" } : {}),
    muted: row.austritt_type !== null,
    ...(row.austritt_type === null ? {} : { chip: austrittChip(row.austritt_type) }),
    cells: {
      spiele: statistik.count_cancelled_spiele > 0 ? { value: played, cancelled: statistik.count_cancelled_spiele } : played,
      siege: { record: formatNumber(statistik.siege) },
      unentschieden: { record: formatNumber(statistik.unentschieden) },
      niederlagen: { record: formatNumber(statistik.niederlagen) },
      record: { counts: [statistik.siege, statistik.unentschieden, statistik.niederlagen] },
      tore: { record: formatErgebnis({ team1: statistik.tore_scored, team2: statistik.tore_conceded }) },
      differenz: { record: formatSigned(statistik.tore_scored - statistik.tore_conceded) },
      punkte: { record: formatNumber(statistik.punkte) },
    },
  };
}

const EMPTY = { kind: "none", plural: COPY.page.tabelle, glyph: "tabelle" } as const;

/** Each group's card, its name and count over its standing, or the empty state while the season holds no group. */
async function readGroups(params: Props["params"]) {
  const saison = await resolvePublicSaisonParam(params);
  const tabelle = await getTabelle(saison);
  if (tabelle === null) notFound();
  const groups = Object.entries(tabelle.gruppen).sort(([one], [other]) => one.localeCompare(other));
  if (groups.length === 0) return <EmptyBox {...EMPTY} />;
  return (
    <>
      {groups.map(([gruppe, rows]) => (
        <Card
          key={gruppe}
          title={SERVER_COPY.season.gruppe(gruppe)}
          // One ⓘ for each group's card, each explaining the marks its standing draws.
          help={SERVER_COPY.season.tabelle.help}
          count={rows.length}>
          <TableStanding
            {...HEAD}
            label={SERVER_COPY.season.gruppe(gruppe)}
            rows={rows.map((row) => rowOf(saison, row, tabelle.qualifiers_per_gruppe, rows))}
            empty={EMPTY}
          />
        </Card>
      ))}
    </>
  );
}
