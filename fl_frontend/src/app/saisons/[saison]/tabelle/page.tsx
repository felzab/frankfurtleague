import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { formatErgebnis, formatNumber } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getTabelle } from "@/features/saisons/queries";
import { pageMetadata } from "@/shared/utils/metadata";

import type { FLTabelleRow } from "@/core/generated/client/types";
import type { TableProps, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/saisons/[saison]/tabelle">;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
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

/** A goal difference, signed where it is not level. */
const signed = (difference: number) => (difference > 0 ? `+${formatNumber(difference)}` : formatNumber(difference));

/**
 * One club's row: its place as the backend numbers it, level clubs sharing one and a club that has played no
 * match holding none; the bar while its place qualifies; muted once it has left the season, „DQ“ where it was
 * disqualified; the matches it played carrying the mark of those called off.
 */
function rowOf(saison: string, row: FLTabelleRow, qualifiers: number): TableRow {
  const { statistik } = row;
  const played = formatNumber(statistik.count_gespielte_spiele);
  return {
    id: row.id,
    anchor: row.id,
    name: row.name,
    href: ROUTES.team.path(saison, row.id),
    plaque: { kuerzel: row.shorthand },
    place: row.platz,
    qualifies: row.platz !== null && row.platz <= qualifiers,
    muted: row.austritt_type !== null,
    ...(row.austritt_type === "disqualifikation" ? { chip: { tone: "danger", label: COPY.shared.disqualified } } : {}),
    cells: {
      spiele: statistik.count_abgesagte_spiele > 0 ? { value: played, cancelled: statistik.count_abgesagte_spiele } : played,
      siege: formatNumber(statistik.siege),
      unentschieden: formatNumber(statistik.unentschieden),
      niederlagen: formatNumber(statistik.niederlagen),
      record: { record: [formatNumber(statistik.siege), formatNumber(statistik.unentschieden), formatNumber(statistik.niederlagen)] },
      tore: formatErgebnis({ team1: statistik.tore_geschossen, team2: statistik.tore_kassiert }),
      differenz: signed(statistik.tore_geschossen - statistik.tore_kassiert),
      punkte: formatNumber(statistik.punkte),
    },
  };
}

async function readGroups(params: Props["params"]) {
  const { saison } = await params;
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
        rows: rows.map((row) => rowOf(saison, row, tabelle.qualifiers_per_gruppe)),
        empty: { kind: "none", plural: COPY.page.tabelle },
      } satisfies TableProps,
    })),
    empty: { kind: "none", plural: COPY.page.tabelle } as const,
  };
}
