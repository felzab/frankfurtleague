import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { formatErgebnis, formatNumber, formatSigned } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getTabelle } from "@/features/saisons/queries";
import { publicSaisonOf, resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { austrittChip } from "@/features/teams/constants";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { FLTabelleRow } from "@/core/generated/client/types";
import type { TableBody, TableHead, TableProps, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/tabelle">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  return metadataFor(publicSaisonOf(params), (saison) =>
    pageMetadata(parent, ROUTES.tabelle, ROUTES.tabelle.path(saison), { description: SERVER_COPY.description.tabelle(saison) }),
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
      list={{ kind: "groups", head: HEAD, wait: { groups: 8, rows: 3 }, content: readGroups(params) }}
    />
  );
}

const { column } = SERVER_COPY.season;

const COLUMNS: TableProps["columns"] = [
  { key: "spiele", label: column.spiele, figures: true, width: "marked" },
  { key: "siege", label: column.siege, figures: true, hideOnPhone: true, width: "count" },
  { key: "unentschieden", label: column.unentschieden, figures: true, hideOnPhone: true, width: "count" },
  { key: "niederlagen", label: column.niederlagen, figures: true, hideOnPhone: true, width: "count" },
  { key: "record", label: column.record, figures: true, phoneOnly: true, width: "pair" },
  { key: "tore", label: column.tore, figures: true, width: "pair" },
  { key: "differenz", label: column.differenz, figures: true, hideOnPhone: true },
  { key: "punkte", label: column.punkte, figures: true, strong: true },
];

/** Every group's table's head, drawn while the Tabelle is read and over each group's rows once it is. */
const HEAD: TableHead = {
  nameLabel: column.team,
  rankLabel: column.platz,
  columns: COLUMNS,
  compact: true,
  chevronOnPhone: false,
  plaqueAlone: true,
};

/**
 * One club's row: its place as the backend numbers it, level clubs sharing one and a club that has played no
 * match holding none; the bar while its place qualifies, grey while level clubs share it; muted once it has left
 * the season, with its exit chip; the matches it played carrying the mark of those called off.
 */
function rowOf(saison: string, row: FLTabelleRow, qualifiers: number, rows: readonly FLTabelleRow[]): TableRow {
  const { statistik } = row;
  const played = { record: formatNumber(statistik.count_played_spiele) };
  const qualifying = row.platz !== null && row.platz <= qualifiers;
  // Level clubs share their place, and the bracket seeds none of them until the tie resolves.
  const level = rows.some((other) => other.id !== row.id && other.platz === row.platz);
  return {
    id: row.id,
    anchor: row.id,
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

async function readGroups(params: Props["params"]) {
  const saison = await resolvePublicSaisonParam(params);
  const tabelle = await getTabelle(saison);
  if (tabelle === null) notFound();
  const groups = Object.entries(tabelle.gruppen).sort(([one], [other]) => one.localeCompare(other));
  return {
    groups: groups.map(([gruppe, rows]) => ({
      id: gruppe,
      title: SERVER_COPY.season.gruppe(gruppe),
      table: {
        label: SERVER_COPY.season.gruppe(gruppe),
        rows: rows.map((row) => rowOf(saison, row, tabelle.qualifiers_per_gruppe, rows)),
        empty: { kind: "none", plural: COPY.page.tabelle, glyph: "tabelle" },
      } satisfies TableBody,
    })),
    empty: { kind: "none", plural: COPY.page.tabelle, glyph: "tabelle" } as const,
  };
}
