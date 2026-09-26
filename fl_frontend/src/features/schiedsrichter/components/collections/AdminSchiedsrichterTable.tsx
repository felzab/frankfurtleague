"use client";

import { memo } from "react";

import Magnifier from "@gravity-ui/icons/Magnifier";
import Pencil from "@gravity-ui/icons/Pencil";
import Person from "@gravity-ui/icons/Person";

import { Table } from "@heroui/react/table";

import { reactivateSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { SCHIEDSRICHTER_CRUD_COPY, SCHIEDSRICHTER_OHNE_NAMEN_LABEL } from "@/features/schiedsrichter/constants";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import {
  CELL_EDGE_CLASSES,
  CELL_INNER_CLASSES,
  COLUMN_EDGE_CLASSES,
  COLUMN_INNER_CLASSES,
  IDENTITY_HEAD_CLASSES,
  IDENTITY_LINE_CLASSES,
  IDENTITY_NAME_BOX_CLASSES,
  IDENTITY_PAIR_CLASSES,
  IDENTITY_ROW_CLASSES,
  IDENTITY_STACK_CLASSES,
  identityName,
  TABLE_HEADING_CLASSES,
} from "@/shared/components/ui/adminTable";
import { card } from "@/shared/components/ui/card";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { RowActionCopy, RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { useReactivation } from "@/shared/hooks/useReactivation";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatEuro } from "@/shared/utils/format";

import { hatAdresse } from "../../schemas";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { FLSchiedsrichter } from "../../schemas";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: SCHIEDSRICHTER_CRUD_COPY.emptyForQuery,
  filtered: SCHIEDSRICHTER_CRUD_COPY.emptyForFilters,
  none: SCHIEDSRICHTER_CRUD_COPY.emptyOverall,
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
  const { isReactivating, reactivate } = useReactivation({ action: reactivateSchiedsrichterAction, noun: "Schiedsrichter" });

  // The sidemenu's season rides along, so the fixture list opens on the season being worked in
  // rather than on the current one.
  const saisonHref = useSaisonHref();

  const handleCopyKontakt = async (details: string) => {
    const copied = await copyTextToClipboard(details);

    if (copied) appToast.success("Kontaktdaten kopiert");
    else appToast.danger("Kontaktdaten nicht kopiert", { description: CLIPBOARD_ERROR_DETAIL });
  };

  // Italic where the row carries no name, so a reader takes the stand-in word for the state it is
  // rather than for somebody's name. „anonym“ cannot reach this cell: that word is the ghost's.
  /* A nameless row on this list is what a hand-write leaves: the one row an erasure creates is the
     ghost, which `GET /schiedsrichter` excludes by id, so no erased person reaches this cell. */
  const renderName = (schiedsrichter: FLSchiedsrichter) =>
    schiedsrichter.name === null ? (
      <span className={`${IDENTITY_NAME_BOX_CLASSES} text-foreground-muted italic`}>{SCHIEDSRICHTER_OHNE_NAMEN_LABEL}</span>
    ) : (
      <span className={identityName(schiedsrichter.inactive_since !== null)}>{schiedsrichter.name}</span>
    );

  const renderHonorar = (schiedsrichter: FLSchiedsrichter) => (
    <span className="inline-flex items-center rounded-md bg-muted px-3 py-1.5 font-numeric fluid-xs font-bold tracking-wide text-foreground tabular-nums">
      {formatEuro(schiedsrichter.default_payment)}
    </span>
  );

  /**
   * The school is the person's affiliation and reads as one under their name; a column of its own
   * leaves it standing alone. An address and a number are what a reader copies once they have found
   * somebody.
   */
  const renderIdentity = (schiedsrichter: FLSchiedsrichter) => (
    <div className={IDENTITY_ROW_CLASSES}>
      <Person
        aria-hidden="true"
        className="size-4.5 shrink-0 text-foreground-muted"
      />
      <div className={IDENTITY_STACK_CLASSES}>
        <div className={IDENTITY_HEAD_CLASSES}>
          {renderName(schiedsrichter)}
          {/* Beside the identity rather than in a column: retirement is the only state a referee has,
              so a column would be empty on every live row. */}
          {schiedsrichter.inactive_since !== null && <RetiredBadge since={schiedsrichter.inactive_since} />}
        </div>
        <span className={IDENTITY_LINE_CLASSES}>{schiedsrichter.schule || <span className="italic">Keine Schule</span>}</span>
        <span className={IDENTITY_PAIR_CLASSES}>
          {/* The placeholder a row without an address holds is shown as the gap it is, not as an address. */}
          <span className={IDENTITY_LINE_CLASSES}>
            {hatAdresse(schiedsrichter.kontakt.email) ? schiedsrichter.kontakt.email : <span className="italic">Keine E-Mail</span>}
          </span>
          <span className={`${IDENTITY_LINE_CLASSES} font-numeric tabular-nums`}>
            {schiedsrichter.kontakt.telefon || <span className="italic">Keine Telefonnummer</span>}
          </span>
        </span>
      </div>
    </div>
  );

  const renderActions = (schiedsrichter: FLSchiedsrichter) => {
    const { name } = schiedsrichter;
    const isRetired = schiedsrichter.inactive_since !== null;

    // The italics marking the stand-in word a STATE reach a screen reader as nothing, so every control
    // on a nameless row names the entry rather than announcing that word as somebody's name.
    const einsatzLabel = name === null ? "Einsätze dieses Eintrags anzeigen" : `Einsätze von ${name} anzeigen`;
    const rowSubject = name === null ? SCHIEDSRICHTER_OHNE_NAMEN_LABEL : `Schiedsrichter ${name}`;
    const kontaktLabel = name === null ? "Kontaktdaten dieses Eintrags kopieren" : `Kontaktdaten von ${name} kopieren`;

    // The stored values and never a displayed stand-in, less the placeholder a row without an address
    // holds: a clipboard carrying either reads as a detail somebody could paste into a message.
    const email = hatAdresse(schiedsrichter.kontakt.email) ? schiedsrichter.kontakt.email : null;
    const kontaktdaten = [name, email, schiedsrichter.kontakt.telefon].filter(Boolean).join(" | ");
    const hasKontakt = Boolean(email) || Boolean(schiedsrichter.kontakt.telefon);

    return (
      <RowActions>
        {/* On the row's OWN id: this list serves no erased person and never the ghost, so no row here
            stands for more fixtures than its own. Inline, and admin-only. */}
        <RowActionLink
          href={saisonHref(`/admin/spielsuche?schiedsrichter=${schiedsrichter.id}`)}
          label="Einsätze anzeigen"
          ariaLabel={einsatzLabel}>
          <Magnifier
            className="size-4.5"
            aria-hidden="true"
          />
        </RowActionLink>
        {/* Keyed on an e-mail or a number and never on the joined text: a name alone would be copied
            under „Kontaktdaten kopiert“ with no way to reach the person on the clipboard. */}
        {hasKontakt && (
          <RowActionCopy
            label="Kontaktdaten kopieren"
            ariaLabel={kontaktLabel}
            onPress={() => handleCopyKontakt(kontaktdaten)}
          />
        )}
        {/* A link and not a press: the referee form edits on a page of its own. */}
        <RowActionLink
          href={saisonHref(`/admin/schiedsrichter/${schiedsrichter.id}`)}
          label="Bearbeiten"
          ariaLabel={`${rowSubject} bearbeiten`}>
          <Pencil
            className="size-4.5"
            aria-hidden="true"
          />
        </RowActionLink>
        {isRetired && (
          <RowActionRestore
            label="Reaktivieren"
            ariaLabel={`${rowSubject} reaktivieren`}
            isPending={isReactivating}
            onPress={() => reactivate({ id: schiedsrichter.id })}
          />
        )}
        {!isRetired && (
          <RowActionDelete
            label="Stilllegen"
            ariaLabel={`${rowSubject} stilllegen`}
            onPress={() => setDeletingSchiedsrichter(schiedsrichter)}
          />
        )}
      </RowActions>
    );
  };

  return (
    <>
      {/* One card per referee, so nothing scrolls horizontally. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSchiedsrichter.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredSchiedsrichter.map((schiedsrichter) => (
          <div
            key={schiedsrichter.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            <div className="flex w-full flex-row items-center gap-3">
              <div className="min-w-0 flex-1">{renderIdentity(schiedsrichter)}</div>
              <span className="shrink-0">{renderHonorar(schiedsrichter)}</span>
            </div>
            <div className="-mx-1 border-t border-border/50 pt-2">{renderActions(schiedsrichter)}</div>
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
                columns plus the Name allowance come to. */}
            <Table.Content
              aria-label="Tabelle aller Schiedsrichter"
              className="min-w-156 table-fixed">
              <Table.Header>
                {/* UNDECLARED: fixed layout gives it everything the columns beside it leave, and it
                    is the only one here holding free text. */}
                <Table.Column
                  isRowHeader
                  className={`${TABLE_HEADING_CLASSES} ${COLUMN_EDGE_CLASSES}`}>
                  Name
                </Table.Column>
                {/* Sized to the euro chip rather than to the heading over it: a chip holds one line,
                    so a column under its width draws it across the cell beside it. */}
                <Table.Column className={`${TABLE_HEADING_CLASSES} ${COLUMN_INNER_CLASSES} w-36`}>Honorar</Table.Column>
                {/* Four controls at most — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className={`${TABLE_HEADING_CLASSES} ${COLUMN_EDGE_CLASSES} w-60 text-right`}>Aktionen</Table.Column>
              </Table.Header>

              {/* `items` plus a render function, never mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSchiedsrichter}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(schiedsrichter: FLSchiedsrichter) => (
                  <Table.Row
                    id={schiedsrichter.id}
                    className="border-b border-border/50 last:border-b-0">
                    <Table.Cell className={CELL_EDGE_CLASSES}>{renderIdentity(schiedsrichter)}</Table.Cell>

                    <Table.Cell className={CELL_INNER_CLASSES}>{renderHonorar(schiedsrichter)}</Table.Cell>

                    <Table.Cell className={CELL_EDGE_CLASSES}>{renderActions(schiedsrichter)}</Table.Cell>
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
