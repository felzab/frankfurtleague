import { memo } from "react";

import { Calendar, Person } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActionDelete, RowActionEdit, RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatEuro } from "@/shared/utils/format";

import type { FLSchiedsrichter } from "../../schemas";

/**
 * Memoised deliberately, and load-bearing — see the long note on `AdminSpielorteTable`. In short:
 * the parent's `useSearchParams()` re-renders this table while it sits hidden in a React Activity
 * tree during navigation elsewhere, and a react-aria collection that re-renders while hidden loses
 * its rows for good. No inline lambdas here. The `query` prop is not stable across a navigation
 * that changes `q` — `memo` cannot bail out then — so the `items` form of `Table.Body` is what
 * actually carries the fix; keep it.
 */
export const AdminSchiedsrichterTable = memo(function AdminSchiedsrichterTable({
  schiedsrichterQuery,
  filteredSchiedsrichter,
  setEditingSchiedsrichter,
  setDeletingSchiedsrichter,
}: {
  schiedsrichterQuery: string;
  filteredSchiedsrichter: FLSchiedsrichter[];
  setEditingSchiedsrichter: (schiedsrichter: FLSchiedsrichter) => void;
  setDeletingSchiedsrichter: (schiedsrichter: FLSchiedsrichter) => void;
}) {
  const handleCopyKontakt = async (schiedsrichter: FLSchiedsrichter) => {
    // Collect available contact info cleanly
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
      <RowActionLink
        href={`/admin/spielsuche?q=${encodeURIComponent(schiedsrichter.name)}`}
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
      <RowActionEdit
        label="Bearbeiten"
        ariaLabel={`Schiedsrichter ${schiedsrichter.name} bearbeiten`}
        onPress={() => setEditingSchiedsrichter(schiedsrichter)}
      />
      <RowActionDelete
        label="Löschen"
        ariaLabel={`Schiedsrichter ${schiedsrichter.name} löschen`}
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
          — the teams table's card pattern, applied here as FE-13 asked). The school column stays
          table-only: on a card it read as an unlabeled stray line, and the edit dialog carries it. */}
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

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
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
                    className="hover:bg-muted/40 border-border/50 border-b transition-colors last:border-b-0">
                    {/* 1. Name */}
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

                    {/* 2. Kontakt (Stacked Email and Phone) */}
                    <Table.Cell className="px-6 py-4">{renderKontakt(schiedsrichter)}</Table.Cell>

                    {/* 3. Schule / Verein */}
                    <Table.Cell className="px-6 py-4">
                      <span className="fluid-sm text-foreground">
                        {schiedsrichter.schule || <span className="text-foreground-muted/50 italic">—</span>}
                      </span>
                    </Table.Cell>

                    {/* 4. Honorar */}
                    <Table.Cell className="px-6 py-4">{renderHonorar(schiedsrichter)}</Table.Cell>

                    {/* 5. Aktionen */}
                    <Table.Cell className="px-6 py-4">{renderActions(schiedsrichter)}</Table.Cell>
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
