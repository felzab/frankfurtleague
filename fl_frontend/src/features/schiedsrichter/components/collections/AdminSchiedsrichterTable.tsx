"use client";

import { memo } from "react";
import { useSearchParams } from "next/navigation";

import { Calendar, Pencil, Person } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { AdminTableSkeletonRows } from "@/shared/components/ui/AdminTableSkeletonRows";
import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActionDelete, RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { TABLE_COLLECTION_FLOOR } from "@/shared/components/ui/tableCollectionFloor";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatEuro } from "@/shared/utils/format";

import type { FLSchiedsrichter } from "../../schemas";

/**
 * Memoised deliberately, and load-bearing — see the long note on `AdminSpielorteTable`. In short:
 * the parent's `useSearchParams()` re-renders this table while it sits hidden in a React Activity
 * tree during navigation elsewhere, and a react-aria collection that re-renders while hidden loses
 * its rows for good. No inline lambdas here. The `query` prop is not stable across a navigation
 * that changes `q`, and `useSearchParams` below subscribes this table to the router directly —
 * `memo` cannot bail out of either — so the `items` form of `Table.Body` carries the fix; keep it.
 */
export const AdminSchiedsrichterTable = memo(function AdminSchiedsrichterTable({
  schiedsrichterQuery,
  filteredSchiedsrichter,
  setDeletingSchiedsrichter,
}: {
  schiedsrichterQuery: string;
  filteredSchiedsrichter: FLSchiedsrichter[];
  setDeletingSchiedsrichter: (schiedsrichter: FLSchiedsrichter) => void;
}) {
  // The sidemenu's season rides along, so the fixture list opens on the season the admin is working
  // in rather than on the current one. Reading it here is safe: the parent view already subscribes
  // this tree to the router.
  const searchParams = useSearchParams();
  const selectedSaisonId = searchParams.get("saison_id");
  const saisonParam = selectedSaisonId ? `&saison_id=${encodeURIComponent(selectedSaisonId)}` : "";

  const handleCopyKontakt = async (schiedsrichter: FLSchiedsrichter) => {
    const details = [schiedsrichter.name, schiedsrichter.kontakt.email, schiedsrichter.kontakt.telefon].filter(Boolean).join(" | ");

    const copied = await copyTextToClipboard(details);

    if (copied) appToast.success("Kontaktdaten kopiert");
    else appToast.danger(CLIPBOARD_ERROR_TITLE, { description: CLIPBOARD_ERROR_DETAIL });
  };

  // One source for both layouts, the teams table's pattern: the `md+` table's cells and the phone
  // cards render these, so the two presentations cannot disagree about a row or its controls.
  const renderKontakt = (schiedsrichter: FLSchiedsrichter) => (
    <div className="flex flex-col gap-0.5">
      <span className="fluid-sm text-foreground">
        {schiedsrichter.kontakt.email || <span className="text-foreground-muted/50 italic">Keine E-Mail</span>}
      </span>
      <span className="fluid-xs text-foreground-muted">
        {schiedsrichter.kontakt.telefon || <span className="text-foreground-muted/50 italic">Keine Telefonnummer</span>}
      </span>
    </div>
  );

  const renderHonorar = (schiedsrichter: FLSchiedsrichter) => (
    <span className="bg-muted text-foreground fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-bold tracking-wide">
      {formatEuro(schiedsrichter.default_payment)}
    </span>
  );

  const renderActions = (schiedsrichter: FLSchiedsrichter) => (
    <RowActions>
      {/* `schiedsrichter` as `buildSpielFacets` declares it, and admin-only there: the public
          Spielsuche declares no such facet, so the same link would drop the parameter and filter nothing. */}
      <RowActionLink
        href={`/admin/spielsuche?schiedsrichter=${schiedsrichter.id}${saisonParam}`}
        label="Einsätze anzeigen"
        ariaLabel={`Einsätze von ${schiedsrichter.name} anzeigen`}>
        <Calendar
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      <RowActionCopy
        label="Kontaktdaten kopieren"
        ariaLabel={`Kontaktdaten von ${schiedsrichter.name} kopieren`}
        onPress={() => handleCopyKontakt(schiedsrichter)}
      />
      {/* A link rather than a press: the referee form edits on a page (ADR-0040), so the pencil is a
          navigation and the shared view renders no edit overlay. */}
      <RowActionLink
        href={`/admin/schiedsrichter/${schiedsrichter.id}`}
        label="Bearbeiten"
        ariaLabel={`Schiedsrichter ${schiedsrichter.name} bearbeiten`}>
        <Pencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      <RowActionDelete
        label="Stilllegen"
        ariaLabel={`Schiedsrichter ${schiedsrichter.name} stilllegen`}
        onPress={() => setDeletingSchiedsrichter(schiedsrichter)}
      />
    </RowActions>
  );

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="fluid-sm text-foreground-muted font-medium">
        {schiedsrichterQuery ? "Keine Schiedsrichter für diese Suche gefunden." : "Es wurden noch keine Schiedsrichter angelegt."}
      </p>
    </div>
  );

  return (
    <>
      {/* The phone layout: one card per referee, no horizontal scrolling anywhere (decided 2026-08-07
          — the teams table's card pattern, applied here). The school column stays
          table-only: on a card it read as an unlabeled stray line, and the edit page carries it. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSchiedsrichter.length === 0 && <div className={`${card()} w-full`}>{emptyState}</div>}
        {filteredSchiedsrichter.map((schiedsrichter) => (
          <div
            key={schiedsrichter.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            <div className="flex w-full flex-row items-center gap-3">
              <Person
                className="text-brand shrink-0"
                width={18}
                height={18}
              />
              <span className="fluid-sm text-foreground min-w-0 truncate font-semibold">{schiedsrichter.name}</span>
              <span className="ml-auto shrink-0">{renderHonorar(schiedsrichter)}</span>
            </div>
            {renderKontakt(schiedsrichter)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(schiedsrichter)}</div>
          </div>
        ))}
      </div>

      <div className="group relative hidden w-full md:block">
        <Table className={`${card()} ${TABLE_COLLECTION_FLOOR} h-fit w-full p-0`}>
          <Table.ScrollContainer className="scrollbar-hide">
            <Table.Content aria-label="Tabelle aller Schiedsrichter">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Name
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Kontakt
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Schule / Verein
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Std. Honorar
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children: the static form stops committing its
                  row collection after a few client navigations away and back. */}
              <Table.Body
                items={filteredSchiedsrichter}
                renderEmptyState={() => emptyState}>
                {(schiedsrichter: FLSchiedsrichter) => (
                  <Table.Row
                    id={schiedsrichter.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <Person
                          className="text-brand shrink-0"
                          width={18}
                          height={18}
                        />
                        <span className="fluid-sm text-foreground font-semibold">{schiedsrichter.name}</span>
                      </div>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderKontakt(schiedsrichter)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">
                      <span className="fluid-sm text-foreground">
                        {schiedsrichter.schule || <span className="text-foreground-muted/50 italic">Keine Schule</span>}
                      </span>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderHonorar(schiedsrichter)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderActions(schiedsrichter)}</Table.Cell>
                  </Table.Row>
                )}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>

        {/* The same bars the fallback drew, over the shell for the render in which react-aria's
            collection is still empty, and for the rest of the minimum once it lands. `tbody` says the
            collection has not landed, the gate says the wait was worth reporting, and the hold keeps
            the answer up long enough to read -- multiplied, so a shut gate wins over both. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl opacity-(--admin-placeholder-gate) group-has-[tbody]:opacity-[calc(var(--admin-placeholder-gate)*var(--admin-placeholder-hold))]">
          <AdminTableSkeletonRows />
        </div>
      </div>
    </>
  );
});
