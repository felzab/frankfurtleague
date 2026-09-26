"use client";

import { memo } from "react";

import Calendar from "@gravity-ui/icons/Calendar";
import Pencil from "@gravity-ui/icons/Pencil";
import Persons from "@gravity-ui/icons/Persons";

import { Table } from "@heroui/react/table";

import { SaisonBadge } from "@/features/saisons/components/ui/SaisonBadge";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import {
  CELL_EDGE_CLASSES,
  CELL_INNER_CLASSES,
  COLUMN_EDGE_CLASSES,
  COLUMN_INNER_CLASSES,
  TABLE_HEADING_CLASSES,
} from "@/shared/components/ui/adminTable";
import { SHORTHAND_CHIP_CLASSES } from "@/shared/components/ui/brandTile";
import { card } from "@/shared/components/ui/card";
import { RowActionLink, RowActionMenu, RowActionMenuItem, RowActions } from "@/shared/components/ui/RowActions";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { formatSpielDatum } from "@/shared/utils/format";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { AdminSaisonRow } from "../../types";

/**
 * The Kürzel chip at a season id's width: four digits where a Kürzel is two letters, both being the
 * short identifier a reader scans a column for. `h-7` fixes the box, so the chip's own `py-1` adds
 * nothing to it.
 */
const ID_CHIP_CLASSES = `${SHORTHAND_CHIP_CLASSES} font-numeric h-7 w-14 tabular-nums shadow-sm`;

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: "Keine Saisons für diese Suche.",
  filtered: "Keine Saisons für diese Filter.",
  none: "Es wurden noch keine Saisons angelegt.",
};

/**
 * Memoised, and load-bearing: `AdminSpielorteTable` carries the collection-identity account. **No
 * delete or retire control on any row**: deleting a season would orphan every row carrying its id,
 * and one that is over is `past`.
 */
export const AdminSaisonsTable = memo(function AdminSaisonsTable({
  filteredSaisons,
  emptiness,
}: {
  filteredSaisons: AdminSaisonRow[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
}) {
  const saisonHref = useSaisonHref();

  // One source for both layouts, so the table and the phone cards cannot disagree.

  // `h-7` on the status badge and the id chip beside it: each sizes itself by its own padding, so one
  // fixed height at both call sites is what keeps them level.
  const renderStatusBadge = (saison: AdminSaisonRow) => (
    <SaisonBadge
      status={saison.status}
      className="h-7 px-2"
    />
  );

  /**
   * `tabular-nums` asks the face for tabular figures, so it needs `font-numeric` beside it
   * (`fl_frontend/eslint.config.mjs :: SOURCE_BANS`).
   */
  const renderZeitraum = (saison: AdminSaisonRow) => (
    <span className="flex flex-row items-baseline gap-x-1 font-numeric tabular-nums">
      <span className="fluid-sm font-bold text-foreground">{formatSpielDatum(saison.start_date)}</span>
      <span className="muted-meta">–</span>
      <span className="fluid-sm font-bold text-foreground">{formatSpielDatum(saison.end_date)}</span>
    </span>
  );

  const renderActions = (saison: AdminSaisonRow) => (
    <RowActions>
      <RowActionLink
        href={saisonHref(`/admin/saisons/${saison.id}`)}
        label="Bearbeiten"
        ariaLabel={`Saison ${saison.id} bearbeiten`}>
        <Pencil
          className="size-4.5"
          aria-hidden="true"
        />
      </RowActionLink>
      {/* Both leave the row for another list, which is what sends them here rather than to an icon
          of their own beside the pencil. */}
      <RowActionMenu ariaLabel={`Weitere Aktionen für Saison ${saison.id}`}>
        <RowActionMenuItem
          id="spieltage"
          href={`/admin/spieltage?saison_id=${encodeURIComponent(saison.id)}`}
          label="Spieltage">
          <Calendar
            aria-hidden="true"
            className="size-4 text-foreground-muted"
          />
        </RowActionMenuItem>
        <RowActionMenuItem
          id="teams"
          href={`/admin/teams?saison_id=${encodeURIComponent(saison.id)}`}
          label="Teams">
          <Persons
            aria-hidden="true"
            className="size-4 text-foreground-muted"
          />
        </RowActionMenuItem>
      </RowActionMenu>
    </RowActions>
  );

  return (
    <>
      {/* The phone layout: one card per season, no horizontal scrolling anywhere — the pattern every
          admin table follows below `md`. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSaisons.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredSaisons.map((saison) => (
          <div
            key={saison.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            <div className="flex w-full flex-row items-center gap-3">
              {/* `shrink-0` here alone: this row is a flex row and the status badge beside the id
                  would otherwise squeeze it. */}
              <span className={ID_CHIP_CLASSES}>{saison.id}</span>
              {renderStatusBadge(saison)}
            </div>
            {renderZeitraum(saison)}
            <div className="-mx-1 border-t border-border/50 pt-2">{renderActions(saison)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* Never scrolled at a width this table renders at
              (`fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`). It stays for a platform
              scrollbar wider than the step allows for and for text zoom, where a clipped column would
              hide a cell a bar reaches. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go, and the minimum is what the declared
                columns plus the Zeitraum allowance come to. */}
            <Table.Content
              aria-label="Tabelle aller Saisons"
              className="min-w-152 table-fixed">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className={`${TABLE_HEADING_CLASSES} ${COLUMN_EDGE_CLASSES} w-28`}>
                  Saison
                </Table.Column>
                {/* UNDECLARED: fixed layout gives it everything the columns beside it leave, and it
                    is the only one here holding free text. */}
                <Table.Column className={`${TABLE_HEADING_CLASSES} ${COLUMN_INNER_CLASSES}`}>Zeitraum</Table.Column>
                <Table.Column className={`${TABLE_HEADING_CLASSES} ${COLUMN_INNER_CLASSES} w-32`}>Status</Table.Column>
                {/* Two controls — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className={`${TABLE_HEADING_CLASSES} ${COLUMN_EDGE_CLASSES} w-36 text-right`}>Aktionen</Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSaisons}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(saison: AdminSaisonRow) => (
                  <Table.Row
                    id={saison.id}
                    className="border-b border-border/50 last:border-b-0">
                    <Table.Cell className={CELL_EDGE_CLASSES}>
                      <span className={ID_CHIP_CLASSES}>{saison.id}</span>
                    </Table.Cell>

                    <Table.Cell className={CELL_INNER_CLASSES}>{renderZeitraum(saison)}</Table.Cell>

                    <Table.Cell className={CELL_INNER_CLASSES}>{renderStatusBadge(saison)}</Table.Cell>

                    <Table.Cell className={CELL_EDGE_CLASSES}>{renderActions(saison)}</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>
    </>
  );
});
