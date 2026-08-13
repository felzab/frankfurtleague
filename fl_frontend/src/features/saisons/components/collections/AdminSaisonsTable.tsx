"use client";

import { memo } from "react";

import { Calendar, Pencil, Persons } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { AdminTableSkeletonRows } from "@/shared/components/ui/AdminTableSkeletonRows";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { TABLE_COLLECTION_FLOOR } from "@/shared/components/ui/tableCollectionFloor";
import { formatSpielDatum } from "@/shared/utils/format";

import type { AdminSaisonRow } from "../../types";

/**
 * Memoised, and load-bearing — see the collection-identity note in `AdminCrudView` and the longer
 * account on `AdminSpielorteTable`: the `items` + render-function form of `Table.Body` is what keeps the
 * rows alive across hidden re-renders, and `memo` is the cheap second layer.
 *
 * **No delete control and no retire control, on any row.** A season is never deleted — that would orphan
 * every spiel, spieltag and junction row carrying its id, none of which cascades — and it is not
 * retirable either: one that is over is `past`, which is what "gone" means here (ADR-0026). So the row's
 * actions are all reads and one edit link, and the seasons page is the one admin table with three
 * columns of facts and nothing destructive in it.
 *
 * **The rollover is not a row action** (decided 2026-08-07). It lives on the season's own editor page,
 * where the incomplete-matches precondition has the room to be a list rather than a number.
 */
export const AdminSaisonsTable = memo(function AdminSaisonsTable({
  saisonsQuery,
  filteredSaisons,
}: {
  saisonsQuery: string;
  filteredSaisons: AdminSaisonRow[];
}) {
  // One source for both layouts: the `md+` table's cells and the phone cards render these, so the two
  // presentations cannot disagree about a season's state.

  // `h-7` on the status badge and on the id chip beside it (decided 2026-08-08): LABEL_BADGE sizes
  // itself by padding and the id chip by its own, so one fixed height at both call sites is what
  // keeps them level.
  const renderStatusBadge = (saison: AdminSaisonRow) => {
    if (saison.status === "active") return <span className={`${LABEL_BADGE} bg-success/15 text-success-strong h-7 px-2`}>Laufend</span>;
    if (saison.status === "future") return <span className={`${LABEL_BADGE} bg-info/15 text-info-strong h-7 px-2`}>Geplant</span>;
    return <span className={`${LABEL_BADGE} bg-muted text-foreground-muted h-7 px-2`}>Abgeschlossen</span>;
  };

  /**
   * The season's span as two dates around a bis-Strich, shared by both layouts (decided 2026-08-08).
   * The dates carry the weight and the dash recedes: spelled as "bis", the span reads as one grey
   * ribbon in which the word outweighs the dates it joins. `tabular-nums` keeps the digits in columns,
   * so two rows' spans line up under each other.
   */
  const renderZeitraum = (saison: AdminSaisonRow) => (
    <span className="flex flex-row items-baseline gap-x-1.5 tabular-nums">
      <span className="fluid-sm text-foreground font-bold">{formatSpielDatum(saison.start_date)}</span>
      <span className="fluid-xs text-foreground-muted font-medium">–</span>
      <span className="fluid-sm text-foreground font-bold">{formatSpielDatum(saison.end_date)}</span>
    </span>
  );

  const renderAufbau = (saison: AdminSaisonRow) => (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="fluid-xs text-foreground-muted font-medium">
        <span className="text-foreground font-bold">{saison.rules.number_of_groups}</span> Gruppen
      </span>
      <span className="fluid-xs text-foreground-muted font-medium">
        <span className="text-foreground font-bold">{saison.teamsCount}</span> Teams
      </span>
      <span className="fluid-xs text-foreground-muted font-medium">
        <span className="text-foreground font-bold">{saison.spieltageCount}</span> Spieltage
      </span>
    </div>
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
        href={`/admin/saisons/${saison.id}`}
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

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="fluid-sm text-foreground-muted font-medium">
        {saisonsQuery ? "Keine Saisons für diese Suche gefunden." : "Es wurden noch keine Saisons angelegt."}
      </p>
    </div>
  );

  return (
    <>
      {/* The phone layout: one card per season, no horizontal scrolling anywhere — the pattern all four
          admin tables follow below `md`. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSaisons.length === 0 && <div className={`${card()} w-full`}>{emptyState}</div>}
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
            {renderAufbau(saison)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(saison)}</div>
          </div>
        ))}
      </div>

      <div className="group relative hidden w-full md:block">
        <Table className={`${card()} ${TABLE_COLLECTION_FLOOR} h-fit w-full p-0`}>
          <Table.ScrollContainer className="scrollbar-hide">
            <Table.Content aria-label="Tabelle aller Saisons">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border w-28 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Saison
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Zeitraum
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Aufbau
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-40 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Status
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSaisons}
                renderEmptyState={() => emptyState}>
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

                    <Table.Cell className="px-3 py-4">{renderAufbau(saison)}</Table.Cell>

                    <Table.Cell className="px-3 py-4">{renderStatusBadge(saison)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderActions(saison)}</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>

        {/* The same bars the Suspense fallback drew, held over the shell for the one render in which
            react-aria's collection is still empty. `tbody` is the discriminator and it is exact: absent
            during that pass, present with rows once populated, present carrying the empty state when
            there genuinely are none. See `tableCollectionFloor.ts` for why the pass exists. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl group-has-[tbody]:hidden">
          <AdminTableSkeletonRows />
        </div>
      </div>
    </>
  );
});
