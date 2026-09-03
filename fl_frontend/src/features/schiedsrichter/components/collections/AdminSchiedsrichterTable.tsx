"use client";

import { memo, useTransition } from "react";

import { Magnifier, Pencil, Person } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { card } from "@/shared/components/ui/card";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { RowActionCopy, RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatEuro } from "@/shared/utils/format";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { FLSchiedsrichter } from "../../schemas";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: "Keine Schiedsrichter für diese Suche.",
  filtered: "Keine Schiedsrichter für diese Filter.",
  none: "Es wurden noch keine Schiedsrichter angelegt.",
};

/** `memo` and `Table.Body`'s `items`: a collection re-rendered while hidden in an Activity tree loses its rows. */
export const AdminSchiedsrichterTable = memo(function AdminSchiedsrichterTable({
  filteredSchiedsrichter,
  emptiness,
  setDeletingSchiedsrichter,
}: {
  filteredSchiedsrichter: FLSchiedsrichter[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
  setDeletingSchiedsrichter: (schiedsrichter: FLSchiedsrichter) => void;
}) {
  const [, startReactivating] = useTransition();

  // The sidemenu's season rides along, so the fixture list opens on the season being worked in
  // rather than on the current one.
  const saisonHref = useSaisonHref();

  const handleCopyKontakt = async (schiedsrichter: FLSchiedsrichter) => {
    const details = [schiedsrichter.name, schiedsrichter.kontakt.email, schiedsrichter.kontakt.telefon].filter(Boolean).join(" | ");

    const copied = await copyTextToClipboard(details);

    if (copied) appToast.success("Kontaktdaten kopiert");
    else appToast.danger(CLIPBOARD_ERROR_TITLE, { description: CLIPBOARD_ERROR_DETAIL });
  };

  // No confirmation step: the reactivation is undone by the retire control that takes its place.
  const handleReactivate = (schiedsrichter: FLSchiedsrichter) => {
    startReactivating(async () => {
      const res = await reactivateSchiedsrichterAction({ id: schiedsrichter.id });
      if (res.success) appToast.success(res.message ?? "Schiedsrichter reaktiviert");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  // One source for both layouts, so the table's cells and the phone cards cannot disagree about a
  // row or its controls.
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

  // Beside the identity rather than in a column: retirement is the only state a referee has, so a
  // column would be empty on every live row.
  const renderRetiredBadge = (schiedsrichter: FLSchiedsrichter) =>
    schiedsrichter.inactive_since === null ? null : <RetiredBadge since={schiedsrichter.inactive_since} />;

  const renderHonorar = (schiedsrichter: FLSchiedsrichter) => (
    <span className="bg-muted text-foreground fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-bold tracking-wide">
      {formatEuro(schiedsrichter.default_payment)}
    </span>
  );

  const renderActions = (schiedsrichter: FLSchiedsrichter) => (
    <RowActions>
      {/* `schiedsrichter` as `buildSpielFacets` declares it, and admin-only there: the public
          Spielsuche declares no such facet, so the same link would filter nothing. */}
      <RowActionLink
        href={saisonHref(`/admin/spielsuche?schiedsrichter=${schiedsrichter.id}`)}
        label="Einsätze anzeigen"
        ariaLabel={`Einsätze von ${schiedsrichter.name} anzeigen`}>
        <Magnifier
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
      {/* A link and not a press: the referee form edits on a page of its own. */}
      <RowActionLink
        href={saisonHref(`/admin/schiedsrichter/${schiedsrichter.id}`)}
        label="Bearbeiten"
        ariaLabel={`Schiedsrichter ${schiedsrichter.name} bearbeiten`}>
        <Pencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      {schiedsrichter.inactive_since !== null ? (
        <RowActionRestore
          label="Reaktivieren"
          ariaLabel={`Schiedsrichter ${schiedsrichter.name} reaktivieren`}
          onPress={() => handleReactivate(schiedsrichter)}
        />
      ) : (
        <RowActionDelete
          label="Stilllegen"
          ariaLabel={`Schiedsrichter ${schiedsrichter.name} stilllegen`}
          onPress={() => setDeletingSchiedsrichter(schiedsrichter)}
        />
      )}
    </RowActions>
  );

  return (
    <>
      {/* One card per referee, so nothing scrolls horizontally. The school column stays table-only:
          on a card it read as an unlabeled stray line, and the edit page carries it. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSchiedsrichter.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredSchiedsrichter.map((schiedsrichter) => (
          <div
            key={schiedsrichter.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4 ${schiedsrichter.inactive_since !== null ? "opacity-80" : ""}`}>
            <div className="flex w-full flex-row items-center gap-3">
              <Person
                className="text-brand shrink-0"
                width={18}
                height={18}
              />
              <span className="fluid-sm text-foreground min-w-0 truncate font-semibold">{schiedsrichter.name}</span>
              <span className="ml-auto shrink-0">{renderHonorar(schiedsrichter)}</span>
            </div>
            {renderRetiredBadge(schiedsrichter)}
            {renderKontakt(schiedsrichter)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(schiedsrichter)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* No `scrollbar-hide`: below the minimum declared on the table this container is the
              only way to reach the columns it cannot fit, and a hidden bar says it is not. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go. The minimum is the four declared
                columns plus 176 for the name, under which it gets nothing. */}
            <Table.Content
              aria-label="Tabelle aller Schiedsrichter"
              className="min-w-6xl table-fixed">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Name
                </Table.Column>
                {/* PINNED to their content's width, so the leftover all goes to the name column. Kontakt is
                    sized to an e-mail; the two beside it to their headings, which run longer than their cells. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-72 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Kontakt
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-56 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Schule / Verein
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-56 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Standard-Honorar
                </Table.Column>
                {/* Four controls at most — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-60 border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` plus a render function, never mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSchiedsrichter}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(schiedsrichter: FLSchiedsrichter) => (
                  <Table.Row
                    id={schiedsrichter.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className="px-6 py-4">
                      <div className={`flex items-center gap-3 ${schiedsrichter.inactive_since !== null ? "opacity-60" : ""}`}>
                        <Person
                          className="text-brand shrink-0"
                          width={18}
                          height={18}
                        />
                        <div className="flex flex-col items-start gap-1">
                          <span className="fluid-sm text-foreground font-semibold">{schiedsrichter.name}</span>
                          {renderRetiredBadge(schiedsrichter)}
                        </div>
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
      </div>
    </>
  );
});
