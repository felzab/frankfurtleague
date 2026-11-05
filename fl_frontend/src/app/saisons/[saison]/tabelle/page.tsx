import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { formatErgebnis, formatNumber, formatSigned } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getTabelle } from "@/features/saisons/queries";
import { resolvePublicSaisonParam } from "@/features/saisons/resolvers";
import { austrittChip } from "@/features/teams/constants";
import { pageMetadata } from "@/shared/utils/metadata";

import type { FLTabelleRow } from "@/core/generated/client/types";
import type { TableProps, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/tabelle">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const saison = await resolvePublicSaisonParam(params);
  return pageMetadata(parent, ROUTES.tabelle, ROUTES.tabelle.path(saison), { description: SERVER_COPY.description.tabelle(saison) });
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
      list={{ kind: "groups", content: readGroups(params) }}
    />
  );
}

const { column } = SERVER_COPY.season;

const COLUMNS: TableProps["columns"] = [
  { key: "spiele", label: column.spiele, figures: true },
  { key: "siege", label: column.siege, figures: true, hideOnPhone: true },
  { key: "unentschieden", label: column.unentschieden, figures: true, hideOnPhone: true },
  { key: "niederlagen", label: column.niederlagen, figures: true, hideOnPhone: true },
  { key: "record", label: column.record, figures: true, phoneOnly: true },
  { key: "tore", label: column.tore, figures: true },
  { key: "differenz", label: column.differenz, figures: true, hideOnPhone: true },
  { key: "punkte", label: column.punkte, figures: true, strong: true },
];

/**
 * One club's row: its place as the backend numbers it, level clubs sharing one and a club that has played no
 * match holding none; the bar while its place qualifies, grey while level clubs share it; muted once it has left
 * the season, with its exit chip; the matches it played carrying the mark of those called off.
 */
function rowOf(saison: string, row: FLTabelleRow, qualifiers: number, rows: readonly FLTabelleRow[]): TableRow {
  const { statistik } = row;
  const played = { record: formatNumber(statistik.count_gespielte_spiele) };
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
      spiele: statistik.count_abgesagte_spiele > 0 ? { value: played, cancelled: statistik.count_abgesagte_spiele } : played,
      siege: { record: formatNumber(statistik.siege) },
      unentschieden: { record: formatNumber(statistik.unentschieden) },
      niederlagen: { record: formatNumber(statistik.niederlagen) },
      record: { counts: [statistik.siege, statistik.unentschieden, statistik.niederlagen] },
      tore: { record: formatErgebnis({ team1: statistik.tore_geschossen, team2: statistik.tore_kassiert }) },
      differenz: { record: formatSigned(statistik.tore_geschossen - statistik.tore_kassiert) },
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
    groups: groups.map(([gruppe, rows = []]) => ({
      id: gruppe,
      title: SERVER_COPY.season.gruppe(gruppe),
      table: {
        label: SERVER_COPY.season.gruppe(gruppe),
        nameLabel: column.team,
        rankLabel: column.platz,
        columns: COLUMNS,
        compact: true,
        chevronOnPhone: false,
        rows: rows.map((row) => rowOf(saison, row, tabelle.qualifiers_per_gruppe, rows)),
        empty: { kind: "none", plural: COPY.page.tabelle },
      } satisfies TableProps,
    })),
    empty: { kind: "none", plural: COPY.page.tabelle } as const,
  };
}
