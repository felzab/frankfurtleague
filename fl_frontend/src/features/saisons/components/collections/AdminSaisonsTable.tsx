"use client";

import { memo } from "react";

import { Calendar, Pencil, Persons } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { formatSpielDatum } from "@/shared/utils/format";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { AdminSaisonRow } from "../../types";

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
  const renderStatusBadge = (saison: AdminSaisonRow) => {
    if (saison.status === "active") return <span className={`${LABEL_BADGE} bg-success/15 text-success-strong h-7 px-2`}>Laufend</span>;
    if (saison.status === "future") return <span className={`${LABEL_BADGE} bg-info/15 text-info-strong h-7 px-2`}>Geplant</span>;
    return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted h-7 px-2`}>Abgeschlossen</span>;
  };

  /**
   * The span as two dates around a bis-Strich. `tabular-nums` keeps the digits in columns, so two
   * rows' spans line up under each other.
   */
  const renderZeitraum = (saison: AdminSaisonRow) => (
    <span className="flex flex-row items-baseline gap-x-1.5 tabular-nums">
      <span className="fluid-sm text-foreground font-bold">{formatSpielDatum(saison.start_date)}</span>
      <span className="muted-meta">–</span>
      <span className="fluid-sm text-foreground font-bold">{formatSpielDatum(saison.end_date)}</span>
    </span>
  );

  const renderActions = (saison: AdminSaisonRow) => (
    <RowActions>
      <RowActionLink
        href={`/admin/spieltage?saison_id=${encodeURIComponent(saison.id)}`}
        label="Spieltage"
        ariaLabel={`Spieltage der Saison ${saison.id} anzeigen`}>
        <Calendar
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      <RowActionLink
        href={`/admin/teams?saison_id=${encodeURIComponent(saison.id)}`}
        label="Teams"
        ariaLabel={`Teams der Saison ${saison.id} anzeigen`}>
        <Persons
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
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
    </RowActions>
  );

  return (
    <>
      {/* The phone layout: one card per season, no horizontal scrolling anywhere — the pattern all four
          admin tables follow below `md`. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSaisons.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredSaisons.map((saison) => (
          <div
            key={saison.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            <div className="flex w-full flex-row items-center gap-3">
              <span className="bg-brand-solid text-brand-solid-foreground fluid-xs inline-flex h-7 w-14 shrink-0 items-center justify-center rounded-md font-extrabold tracking-wide shadow-sm">
                {saison.id}
              </span>
              {renderStatusBadge(saison)}
            </div>
            {renderZeitraum(saison)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(saison)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* No `scrollbar-hide`: below the minimum declared on the table this container is the
              only way to reach the columns it cannot fit, and a hidden bar says it is not. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go. The minimum is the three declared
                columns plus 304 for the span, which needs 236 to set its two dates on one line. */}
            <Table.Content
              aria-label="Tabelle aller Saisons"
              className="min-w-3xl table-fixed">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border w-28 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Saison
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Zeitraum
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-40 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Status
                </Table.Column>
                {/* Three controls — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-48 border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSaisons}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(saison: AdminSaisonRow) => (
                  <Table.Row
                    id={saison.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className="px-6 py-4">
                      {/* The season id wears the same chip fill a team's Kürzel does: both are the short
                          identifier a reader scans a column for. */}
                      <span className="bg-brand-solid text-brand-solid-foreground fluid-xs inline-flex h-7 w-14 items-center justify-center rounded-md font-extrabold tracking-wide shadow-sm">
                        {saison.id}
                      </span>
                    </Table.Cell>

                    <Table.Cell className="px-3 py-4">{renderZeitraum(saison)}</Table.Cell>

                    <Table.Cell className="px-3 py-4">{renderStatusBadge(saison)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderActions(saison)}</Table.Cell>
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
