"use client";

import { memo, useTransition } from "react";

import { Magnifier, Pencil, Person } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { SCHIEDSRICHTER_OHNE_NAMEN_LABEL, schiedsrichterAnzeigename } from "@/features/schiedsrichter/constants";
import { schiedsrichterFacetValue } from "@/features/spiele/facets";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import {
  CELL_EDGE,
  CELL_INNER,
  COLUMN_EDGE,
  COLUMN_INNER,
  IDENTITY_HEAD,
  IDENTITY_LINE,
  IDENTITY_NAME,
  IDENTITY_NAME_BOX,
  IDENTITY_PAIR,
  IDENTITY_ROW,
  IDENTITY_STACK,
  TABLE_HEADING,
} from "@/shared/components/ui/adminTable";
import { card } from "@/shared/components/ui/card";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import { RowActionCopy, RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatEuro } from "@/shared/utils/format";

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

  const handleCopyKontakt = async (details: string) => {
    const copied = await copyTextToClipboard(details);

    if (copied) appToast.success("Kontaktdaten kopiert");
    else appToast.danger(CLIPBOARD_ERROR_TITLE, { description: CLIPBOARD_ERROR_DETAIL });
  };

  // No confirmation step: the reactivation is undone by the retire control that takes its place.
  const handleReactivate = (schiedsrichter: FLSchiedsrichter) => {
    startReactivating(async () => {
      const res = await reactivateSchiedsrichterAction({ id: schiedsrichter.id });
      if (res.success) appToast.success("Schiedsrichter reaktiviert");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error });
    });
  };

  // Italic where the row carries no name, so a reader takes the stand-in word for the state it is
  // rather than for somebody's name.
  /* A nameless row on this list is what a hand-write leaves: the store types `name` and
     `anonymisiert_am` nullable independently (`fl_backend/app/core/constraints.py`), and no endpoint
     writes the one without the other, the list serving no stamped row at all. */
  const renderName = (schiedsrichter: FLSchiedsrichter) =>
    schiedsrichter.name === null ? (
      <span className={`${IDENTITY_NAME_BOX} text-foreground-muted italic`}>{schiedsrichterAnzeigename(schiedsrichter.name)}</span>
    ) : (
      <span className={IDENTITY_NAME}>{schiedsrichter.name}</span>
    );

  const renderHonorar = (schiedsrichter: FLSchiedsrichter) => (
    <span className="bg-muted text-foreground font-numeric fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-bold tracking-wide tabular-nums">
      {formatEuro(schiedsrichter.default_payment)}
    </span>
  );

  /**
   * The school is the person's affiliation and reads as one under their name; a column of its own
   * leaves it standing alone. An address and a number are what a reader copies once they have found
   * somebody.
   */
  const renderIdentity = (schiedsrichter: FLSchiedsrichter, dimmed: boolean) => (
    <div className={`${IDENTITY_ROW} ${dimmed ? "opacity-60" : ""}`}>
      <Person
        aria-hidden="true"
        className="text-brand shrink-0"
        width={18}
        height={18}
      />
      <div className={IDENTITY_STACK}>
        <div className={IDENTITY_HEAD}>
          {renderName(schiedsrichter)}
          {/* Beside the identity rather than in a column: retirement is the only state a referee has,
              so a column would be empty on every live row. */}
          {schiedsrichter.inactive_since !== null && <RetiredBadge since={schiedsrichter.inactive_since} />}
        </div>
        <span className={IDENTITY_LINE}>{schiedsrichter.schule || <span className="italic">Keine Schule</span>}</span>
        <span className={IDENTITY_PAIR}>
          <span className={IDENTITY_LINE}>{schiedsrichter.kontakt.email || <span className="italic">Keine E-Mail</span>}</span>
          <span className={`${IDENTITY_LINE} font-numeric tabular-nums`}>
            {schiedsrichter.kontakt.telefon || <span className="italic">Keine Telefonnummer</span>}
          </span>
        </span>
      </div>
    </div>
  );

  const renderActions = (schiedsrichter: FLSchiedsrichter) => {
    // The value is `schiedsrichterFacetValue`'s, never the id: a nameless referee shares one merged
    // option, and an unoffered value is dropped rather than refused.
    const facetValue = schiedsrichterFacetValue(schiedsrichter);
    // Read off that value rather than off the name again, so the link and the option it selects
    // cannot part company.
    const zusammengefasst = facetValue !== schiedsrichter.id;
    // The label names the merged set, because a fee is reconciled against what the link opened. Its
    // own state and not the erasure's: this list serves no stamped row, so a missing name is all the
    // link can stand on.
    const einsatzLabel = zusammengefasst ? "Einsätze aller Schiedsrichter ohne Namen anzeigen" : "Einsätze anzeigen";
    const angezeigt = schiedsrichterAnzeigename(schiedsrichter.name);

    const isRetired = schiedsrichter.inactive_since !== null;

    // The italics that mark „anonym“ a state on screen reach a screen reader as nothing, so a label
    // built on `angezeigt` announces the state as this person's name.
    const nennung = schiedsrichter.name === null ? SCHIEDSRICHTER_OHNE_NAMEN_LABEL : `Schiedsrichter ${angezeigt}`;
    const kontaktLabel = schiedsrichter.name === null ? "Kontaktdaten dieses Eintrags kopieren" : `Kontaktdaten von ${angezeigt} kopieren`;

    // The stored values and never the displayed label: a clipboard carrying „anonym“ reads as a detail
    // somebody could paste into a message.
    const kontaktdaten = [schiedsrichter.name, schiedsrichter.kontakt.email, schiedsrichter.kontakt.telefon].filter(Boolean).join(" | ");

    return (
      <RowActions>
        {/* The row's ONE way elsewhere, so it stays inline: a menu holding a single item costs a press
            and buys nothing. Admin-only, the public Spielsuche declaring no such facet. */}
        <RowActionLink
          href={saisonHref(`/admin/spielsuche?schiedsrichter=${facetValue}`)}
          label={einsatzLabel}
          ariaLabel={zusammengefasst ? einsatzLabel : `Einsätze von ${angezeigt} anzeigen`}>
          <Magnifier
            aria-hidden="true"
            width={18}
            height={18}
          />
        </RowActionLink>
        {/* No control where there is nothing to copy: an empty write is refused at
            `fl_frontend/src/shared/utils/clipboard.ts :: copyTextToClipboard`, so the press could only
            raise the failure toast. */}
        {kontaktdaten !== "" && (
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
          ariaLabel={`${nennung} bearbeiten`}>
          <Pencil
            aria-hidden="true"
            width={18}
            height={18}
          />
        </RowActionLink>
        {isRetired && (
          <RowActionRestore
            label="Reaktivieren"
            ariaLabel={`${nennung} reaktivieren`}
            onPress={() => handleReactivate(schiedsrichter)}
          />
        )}
        {!isRetired && (
          <RowActionDelete
            label="Stilllegen"
            ariaLabel={`${nennung} stilllegen`}
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
            className={`${card()} flex w-full flex-col gap-y-3 p-4 ${schiedsrichter.inactive_since !== null ? "opacity-80" : ""}`}>
            <div className="flex w-full flex-row items-center gap-3">
              {/* Undimmed: the card dims its whole box, so a second grade inside it would compound. */}
              <div className="min-w-0 flex-1">{renderIdentity(schiedsrichter, false)}</div>
              <span className="shrink-0">{renderHonorar(schiedsrichter)}</span>
            </div>
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(schiedsrichter)}</div>
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
                  className={`${TABLE_HEADING} ${COLUMN_EDGE}`}>
                  Name
                </Table.Column>
                {/* Sized to the euro chip rather than to the heading over it: a chip holds one line,
                    so a column under its width draws it across the cell beside it. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER} w-36`}>Honorar</Table.Column>
                {/* Four controls at most — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_EDGE} w-60 text-right`}>Aktionen</Table.Column>
              </Table.Header>

              {/* `items` plus a render function, never mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSchiedsrichter}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(schiedsrichter: FLSchiedsrichter) => (
                  <Table.Row
                    id={schiedsrichter.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className={CELL_EDGE}>{renderIdentity(schiedsrichter, schiedsrichter.inactive_since !== null)}</Table.Cell>

                    <Table.Cell className={CELL_INNER}>{renderHonorar(schiedsrichter)}</Table.Cell>

                    <Table.Cell className={CELL_EDGE}>{renderActions(schiedsrichter)}</Table.Cell>
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
