"use client";

import { memo } from "react";

import { Calendar, Pencil, Persons } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { SaisonBadge } from "@/features/saisons/components/ui/SaisonBadge";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { CELL_EDGE, CELL_INNER, COLUMN_EDGE, COLUMN_INNER, TABLE_HEADING } from "@/shared/components/ui/adminTable";
import { card } from "@/shared/components/ui/card";
import { RowActionLink, RowActionMenu, RowActionMenuItem, RowActions } from "@/shared/components/ui/RowActions";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { formatSpielDatum } from "@/shared/utils/format";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { AdminSaisonRow } from "../../types";

/**
 * The season id wears the same chip fill a team's Kürzel does
 * (`fl_frontend/src/features/spieler/shorthandChip.ts :: SHORTHAND_CHIP`): both are the short
 * identifier a reader scans a column for.
 */
const ID_CHIP =
  "bg-brand-solid text-brand-solid-foreground font-numeric fluid-xs inline-flex h-7 w-14 items-center justify-center rounded-md font-extrabold tracking-wide tabular-nums shadow-sm";

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
   * (`fl_frontend/src/core/numericFigures.test.ts :: PAIR`).
   */
  const renderZeitraum = (saison: AdminSaisonRow) => (
    <span className="font-numeric flex flex-row items-baseline gap-x-1 tabular-nums">
      <span className="fluid-sm text-foreground font-bold">{formatSpielDatum(saison.start_date)}</span>
      <span className="muted-meta">–</span>
      <span className="fluid-sm text-foreground font-bold">{formatSpielDatum(saison.end_date)}</span>
    </span>
  );

  const renderActions = (saison: AdminSaisonRow) => (
    <RowActions>
      <RowActionLink
        href={saisonHref(`/admin/saisons/${saison.id}`)}
        label="Bearbeiten"
        ariaLabel={`Saison ${saison.id} bearbeiten`}>
        <Pencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      {/* Both leave the row for another list, which is what sends them here rather than to an icon
          of their own beside the pencil. */}
      <RowActionMenu ariaLabel={`Weitere Aktionen für Saison ${saison.id}`}>
        <RowActionMenuItem
          id="spieltage"
          href={`/admin/spieltage?saison_id=${encodeURIComponent(saison.id)}`}
          label="Spieltage">
          <Calendar className="text-foreground-muted size-4" />
        </RowActionMenuItem>
        <RowActionMenuItem
          id="teams"
          href={`/admin/teams?saison_id=${encodeURIComponent(saison.id)}`}
          label="Teams">
          <Persons className="text-foreground-muted size-4" />
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
              <span className={`${ID_CHIP} shrink-0`}>{saison.id}</span>
              {renderStatusBadge(saison)}
            </div>
            {renderZeitraum(saison)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(saison)}</div>
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
                  className={`${TABLE_HEADING} ${COLUMN_EDGE} w-28`}>
                  Saison
                </Table.Column>
                {/* UNDECLARED: fixed layout gives it everything the columns beside it leave, and it
                    is the only one here holding free text. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER}`}>Zeitraum</Table.Column>
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER} w-32`}>Status</Table.Column>
                {/* Two controls — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_EDGE} w-36 text-right`}>Aktionen</Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSaisons}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(saison: AdminSaisonRow) => (
                  <Table.Row
                    id={saison.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className={CELL_EDGE}>
                      <span className={ID_CHIP}>{saison.id}</span>
                    </Table.Cell>

                    <Table.Cell className={CELL_INNER}>{renderZeitraum(saison)}</Table.Cell>

                    <Table.Cell className={CELL_INNER}>{renderStatusBadge(saison)}</Table.Cell>

                    <Table.Cell className={CELL_EDGE}>{renderActions(saison)}</Table.Cell>
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
