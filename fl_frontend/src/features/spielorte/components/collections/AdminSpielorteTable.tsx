"use client";

import { memo, useTransition } from "react";

import { Globe, Magnifier, MapPin, Pencil } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateSpielortAction } from "@/features/spielorte/actions";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import {
  CELL_EDGE,
  CELL_INNER,
  COLUMN_EDGE,
  COLUMN_INNER,
  IDENTITY_HEAD,
  IDENTITY_LINE,
  IDENTITY_NAME,
  IDENTITY_ROW,
  IDENTITY_STACK,
  TABLE_HEADING,
} from "@/shared/components/ui/adminTable";
import { card } from "@/shared/components/ui/card";
import { RetiredBadge } from "@/shared/components/ui/RetiredBadge";
import {
  RowActionCopy,
  RowActionDelete,
  RowActionLink,
  RowActionMenu,
  RowActionMenuItem,
  RowActionRestore,
  RowActions,
} from "@/shared/components/ui/RowActions";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatAddressFull, formatEuro } from "@/shared/utils/format";

import { formatMapsLink } from "../../utils";

import type { CrudEmptiness } from "@/shared/components/ui/AdminCrudView";
import type { FLSpielort } from "../../schemas";

const EMPTY_MESSAGES: Record<CrudEmptiness, string> = {
  searched: "Keine Spielorte für diese Suche.",
  filtered: "Keine Spielorte für diese Filter.",
  none: "Es wurden noch keine Spielorte angelegt.",
};

/** `memo` and `Table.Body`'s `items`: a collection re-rendered while hidden in an Activity tree loses its rows. */
export const AdminSpielorteTable = memo(function AdminSpielorteTable({
  filteredSpielorte,
  emptiness,
  setDeletingOrt,
}: {
  filteredSpielorte: FLSpielort[];
  /** `fl_frontend/src/shared/components/ui/AdminCrudView.tsx :: CrudEmptiness` carries what each value means. */
  emptiness: CrudEmptiness;
  setDeletingOrt: (ort: FLSpielort) => void;
}) {
  const [, startReactivating] = useTransition();

  // The sidemenu's season rides along, so the fixture list opens on the season being worked in
  // rather than on the current one.
  const saisonHref = useSaisonHref();

  const handleCopyAddress = async (ort: FLSpielort) => {
    const copied = await copyTextToClipboard(`${ort.name}, ${formatAddressFull(ort.address)}`);

    if (copied) appToast.success("Adresse kopiert");
    else appToast.danger("Adresse nicht kopiert", { description: CLIPBOARD_ERROR_DETAIL });
  };

  // No confirmation step: the reactivation is undone by the retire control that takes its place.
  const handleReactivate = (ort: FLSpielort) => {
    startReactivating(async () => {
      const res = await reactivateSpielortAction({ id: ort.id });
      if (res.success) appToast.success("Spielort reaktiviert");
      else appToast.danger("Spielort nicht reaktiviert", { description: res.error });
    });
  };

  const renderMietpreis = (ort: FLSpielort) => (
    <span className="bg-muted text-foreground font-numeric fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-bold tracking-wide tabular-nums">
      {formatEuro(ort.default_mietpreis)}
    </span>
  );

  // Beside the identity rather than in a column: retirement is the only state a venue has, so a
  // column would be empty on every live row.
  const renderRetiredBadge = (ort: FLSpielort) => (ort.inactive_since === null ? null : <RetiredBadge since={ort.inactive_since} />);

  /**
   * The address is the venue's second fact rather than something scanned across rows, so it reads
   * under the name. Two lines and not one: a district joined to its street truncates at every width
   * the table renders at.
   */
  const renderIdentity = (ort: FLSpielort, dimmed: boolean) => (
    <div className={`${IDENTITY_ROW} ${dimmed ? "opacity-60" : ""}`}>
      <MapPin
        aria-hidden="true"
        className="text-brand size-4.5 shrink-0"
      />
      <div className={IDENTITY_STACK}>
        <div className={IDENTITY_HEAD}>
          <span className={IDENTITY_NAME}>{ort.name}</span>
          {renderRetiredBadge(ort)}
        </div>
        <span className={IDENTITY_LINE}>
          {ort.address.strasse} {ort.address.hausnummer}
        </span>
        <span className={IDENTITY_LINE}>
          {ort.address.plz} {ort.address.stadt}
          {ort.address.stadtteil && ` (${ort.address.stadtteil})`}
        </span>
      </div>
    </div>
  );

  const renderActions = (ort: FLSpielort) => (
    <RowActions>
      <RowActionCopy
        label="Adresse kopieren"
        ariaLabel={`Adresse von ${ort.name} kopieren`}
        onPress={() => handleCopyAddress(ort)}
      />
      {/* A link and not a press: the venue form edits on a page of its own. */}
      <RowActionLink
        href={saisonHref(`/admin/spielorte/${ort.id}`)}
        label="Bearbeiten"
        ariaLabel={`Spielort ${ort.name} bearbeiten`}>
        <Pencil
          className="size-4.5"
          aria-hidden="true"
        />
      </RowActionLink>
      {ort.inactive_since !== null ? (
        <RowActionRestore
          label="Reaktivieren"
          ariaLabel={`Spielort ${ort.name} reaktivieren`}
          onPress={() => handleReactivate(ort)}
        />
      ) : (
        <RowActionDelete
          label="Stilllegen"
          ariaLabel={`Spielort ${ort.name} stilllegen`}
          onPress={() => setDeletingOrt(ort)}
        />
      )}
      {/* Both leave the row; the copy above acts on it, which is what keeps that one inline. */}
      <RowActionMenu ariaLabel={`Weitere Aktionen für Spielort ${ort.name}`}>
        <RowActionMenuItem
          id="maps"
          href={formatMapsLink(ort)}
          label="Auf Maps öffnen"
          external>
          <Globe
            aria-hidden="true"
            className="text-foreground-muted size-4"
          />
        </RowActionMenuItem>
        {/* `ort` as `buildSpielFacets` declares it, carrying the id its options are keyed by. A `q=`
            here would fuzzy-match every `SEARCH_KEYS` entry and light no chip. */}
        <RowActionMenuItem
          id="spiele"
          href={saisonHref(`/admin/spielsuche?ort=${ort.id}`)}
          label="Spiele anzeigen">
          <Magnifier
            aria-hidden="true"
            className="text-foreground-muted size-4"
          />
        </RowActionMenuItem>
      </RowActionMenu>
    </RowActions>
  );

  return (
    <>
      {/* One card per venue, so nothing scrolls horizontally. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSpielorte.length === 0 && <AdminCrudEmptyCard message={EMPTY_MESSAGES[emptiness]} />}
        {filteredSpielorte.map((ort) => (
          <div
            key={ort.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4 ${ort.inactive_since !== null ? "opacity-80" : ""}`}>
            <div className="flex w-full flex-row items-center gap-3">
              {/* Undimmed: the card dims its whole box, so a second grade inside it would compound. */}
              <div className="min-w-0 flex-1">{renderIdentity(ort, false)}</div>
              <span className="shrink-0">{renderMietpreis(ort)}</span>
            </div>
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(ort)}</div>
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
              aria-label="Tabelle aller Spielorte"
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
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_INNER} w-36`}>Mietpreis</Table.Column>
                {/* Four controls — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className={`${TABLE_HEADING} ${COLUMN_EDGE} w-60 text-right`}>Aktionen</Table.Column>
              </Table.Header>

              {/* `items` plus a render function, never mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSpielorte}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(ort: FLSpielort) => (
                  <Table.Row
                    id={ort.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className={CELL_EDGE}>{renderIdentity(ort, ort.inactive_since !== null)}</Table.Cell>

                    <Table.Cell className={CELL_INNER}>{renderMietpreis(ort)}</Table.Cell>

                    <Table.Cell className={CELL_EDGE}>{renderActions(ort)}</Table.Cell>
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
