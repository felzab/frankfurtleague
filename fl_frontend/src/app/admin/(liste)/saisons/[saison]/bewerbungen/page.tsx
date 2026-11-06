import { notFound } from "next/navigation";

import { ListPage } from "@/kit/ListPage";

import { COPY } from "@/core/copy";
import { dayOf, formatDate } from "@/core/format";
import { ROUTES } from "@/core/routes";
import { SERVER_COPY } from "@/core/serverCopy";
import { getBewerbungenOfSaison } from "@/features/bewerbungen/queries";
import { SEATS, STANDING_CHIP, standingOf } from "@/features/bewerbungen/standing";
import { pageMetadata } from "@/shared/utils/metadata";
import { metadataFor } from "@/shared/utils/notFoundMetadata";

import type { Copy } from "@/core/copy";
import type { FLBewerbungListRow } from "@/core/generated/client/types";
import type { Standing } from "@/features/bewerbungen/standing";
import type { Filter } from "@/kit/Filters";
import type { TableHead, TableRow } from "@/kit/Table";
import type { Metadata, ResolvingMetadata } from "next";

type Props = PageProps<"/admin/saisons/[saison]/bewerbungen">;

const WORDS = COPY.admin.bewerbung;
const ALL = SERVER_COPY.season.filter.all;

export async function generateMetadata({ params }: Props, parent: ResolvingMetadata): Promise<Metadata> {
  const { saison } = await params;
  return metadataFor(getBewerbungenOfSaison(saison), () => pageMetadata(parent, ROUTES.adminBewerbungen, ROUTES.adminBewerbungen.path(saison)));
}

/** The table's head, drawn while the rows are read and over them once they are: a phone keeps the name and its chip. */
const HEAD: TableHead = {
  nameLabel: COPY.shared.facts.school,
  columns: [
    { key: "received", label: WORDS.received, hideOnPhone: true, width: "date" },
    { key: "seats", label: COPY.admin.spiel.bestaetigungen, hideOnPhone: true },
  ],
};

const STANDINGS: readonly Standing[] = ["incomplete", "complete", "accepted", "declined"];

const STAND_OPTIONS: ReadonlyArray<{ id: Standing; label: Copy }> = STANDINGS.map((id) => ({ id, label: STANDING_CHIP[id].label }));

const ORIGIN_OPTIONS = [
  { id: "new", label: WORDS.newSchool },
  { id: "existing", label: WORDS.existingTeam },
] as const;

/** The address's value of a filter, where its options hold it. */
function chosen<Id extends string>(value: string | string[] | undefined, options: ReadonlyArray<{ id: Id }>): Id | null {
  const named = Array.isArray(value) ? value[0] : value;
  return options.find((option) => option.id === named)?.id ?? null;
}

/** One application's row, opening its review page: an open Dublette's chip stands in its standing's place. */
function rowOf(row: FLBewerbungListRow, saison: string): TableRow {
  return {
    id: row.id,
    name: { record: row.name },
    href: ROUTES.adminBewerbung.path(saison, row.id),
    chip: row.duplicate ? { tone: "warn", label: WORDS.teamDouble } : STANDING_CHIP[standingOf(row)],
    cells: {
      received: { record: formatDate(dayOf(row.submitted_at)) },
      seats: COPY.admin.seatsOf(row.seats_confirmed, SEATS),
    },
  };
}

/**
 * The season's applications, read whole, and what the address narrows them to: where an application stands has no field
 * a read could narrow on, and the Sammel-Zusage counts the season's whole, whatever the filters leave.
 */
async function readList(params: Props["params"], searchParams: Props["searchParams"]) {
  const { saison } = await params;
  const read = await getBewerbungenOfSaison(saison);
  if (read === null) notFound();
  const { stand: named, herkunft } = await searchParams;
  const stand = chosen(named, STAND_OPTIONS);
  const origin = chosen(herkunft, ORIGIN_OPTIONS);
  const filters: Filter[] = [
    { name: "stand", label: COPY.admin.schiedsrichter.state, all: ALL, options: STAND_OPTIONS, value: stand },
    { name: "herkunft", label: WORDS.origin, all: ALL, options: ORIGIN_OPTIONS, value: origin },
  ];
  const rows = read.bewerbungen.filter(
    (row) => (stand === null || standingOf(row) === stand) && (origin === null || row.new_school === (origin === "new")),
  );
  const canBulk = read.saison.status === "future" && read.bewerbungen.some((row) => standingOf(row) === "complete");
  return {
    filters,
    bulk: canBulk ? ROUTES.adminBewerbungenBulk.path(saison) : null,
    cut: read.complete ? null : WORDS.cut,
    table: {
      label: ROUTES.adminBewerbungen.title,
      rows: rows.map((row) => rowOf(row, saison)),
      empty: {
        kind: stand === null && origin === null ? "none" : "filter",
        plural: ROUTES.adminBewerbungen.title,
        glyph: "bewerbungen",
      } as const,
    },
  };
}

/**
 * The season's applications as a table, a row opening the application's page, which holds its two verbs: on a desk when
 * each came in and how many seats confirmed, on a phone the name and its chip. Searched on the page, narrowed in the
 * address, and the Sammel-Zusage a link beside them while a complete, undecided application stands.
 */
export default function BewerbungenPage({ params, searchParams }: Props) {
  const list = readList(params, searchParams);
  return (
    <ListPage
      head={{ scope: "area", title: { route: "adminBewerbungen" } }}
      filters={list.then(({ filters }) => filters)}
      filterCount={2}
      link={{ label: COPY.page.adminBewerbungenBulk, href: list.then(({ bulk }) => bulk) }}
      notice={list.then(({ cut }) => cut)}
      list={{
        kind: "table",
        search: { label: WORDS.search },
        head: HEAD,
        content: list.then(({ table }) => ({ table })),
      }}
    />
  );
}
