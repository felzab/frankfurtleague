"use client";

import { memo, useTransition } from "react";

import { Globe, Magnifier, MapPin, Pencil } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateSpielortAction } from "@/features/spielorte/actions";
import { AdminCrudEmptyCard, AdminCrudEmptyRow } from "@/shared/components/ui/AdminCrudEmpty";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { useSaisonHref } from "@/shared/hooks/useSaisonHref";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatAddressFull, formatEuro, formatSpielDatum } from "@/shared/utils/format";
import { UNKNOWN_REFUSAL } from "@/shared/utils/refusal";

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
    else appToast.danger(CLIPBOARD_ERROR_TITLE, { description: CLIPBOARD_ERROR_DETAIL });
  };

  // No confirmation step: the reactivation is undone by the retire control that takes its place.
  const handleReactivate = (ort: FLSpielort) => {
    startReactivating(async () => {
      const res = await reactivateSpielortAction({ id: ort.id });
      if (res.success) appToast.success(res.message ?? "Spielort reaktiviert");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? UNKNOWN_REFUSAL });
    });
  };

  // One source for both layouts, so the table's cells and the phone cards cannot disagree about a
  // row or its controls.
  const renderAddress = (ort: FLSpielort) => (
    <div className="flex flex-col gap-0.5">
      <span className="fluid-sm text-foreground">
        {ort.address.strasse} {ort.address.hausnummer}
      </span>
      <span className="fluid-xs text-foreground-muted">
        {ort.address.plz} {ort.address.stadt}
        {ort.address.stadtteil && ` (${ort.address.stadtteil})`}
      </span>
    </div>
  );

  // Beside the identity rather than in a column: retirement is the only state a venue has, so a
  // column would be empty on every live row.
  const renderRetiredBadge = (ort: FLSpielort) =>
    ort.inactive_since === null ? null : (
      <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt seit {formatSpielDatum(ort.inactive_since)}</span>
    );

  const renderMietpreis = (ort: FLSpielort) => (
    <span className="bg-muted text-foreground fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-bold tracking-wide">
      {formatEuro(ort.default_mietpreis)}
    </span>
  );

  const renderActions = (ort: FLSpielort) => (
    <RowActions>
      <RowActionLink
        href={formatMapsLink(ort)}
        label="Auf Maps öffnen"
        ariaLabel={`${ort.name} auf Google Maps öffnen`}
        external>
        <Globe
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
      {/* `ort` as `buildSpielFacets` declares it, carrying the id its options are keyed by. A `q=`
          here would fuzzy-match every `SEARCH_KEYS` entry and light no chip. */}
      <RowActionLink
        href={saisonHref(`/admin/spielsuche?ort=${ort.id}`)}
        label="Spiele anzeigen"
        ariaLabel={`Spiele in ${ort.name} anzeigen`}>
        <Magnifier
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>
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
          aria-hidden="true"
          width={18}
          height={18}
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
              <MapPin
                className="text-brand shrink-0"
                width={18}
                height={18}
              />
              <span className="fluid-sm text-foreground min-w-0 truncate font-semibold">{ort.name}</span>
              <span className="ml-auto shrink-0">{renderMietpreis(ort)}</span>
            </div>
            {renderRetiredBadge(ort)}
            {renderAddress(ort)}
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(ort)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          {/* No `scrollbar-hide`: below the minimum declared on the table this container is the
              only way to reach the columns it cannot fit, and a hidden bar says it is not. */}
          <Table.ScrollContainer>
            {/* Fixed layout holds the columns when the rows go. The minimum is the three declared
                columns plus 224 for the name, under which it gets nothing. */}
            <Table.Content
              aria-label="Tabelle aller Spielorte"
              className="min-w-5xl table-fixed">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Name
                </Table.Column>
                {/* PINNED to their content's width, so the leftover all goes to the name column. The action
                    column is the widest: every row here ends in five controls, one of them a maps link. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-80 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Adresse
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-48 border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Std. Mietpreis
                </Table.Column>
                {/* Five controls — `fl_frontend/src/shared/components/ui/adminCrudEmpty.test.ts`
                holds the arithmetic, and it is the count a new action changes. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-72 border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` plus a render function, never mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSpielorte}
                renderEmptyState={() => <AdminCrudEmptyRow message={EMPTY_MESSAGES[emptiness]} />}>
                {(ort: FLSpielort) => (
                  <Table.Row
                    id={ort.id}
                    className="border-border/50 border-b last:border-b-0">
                    <Table.Cell className="px-6 py-4">
                      <div className={`flex items-center gap-3 ${ort.inactive_since !== null ? "opacity-60" : ""}`}>
                        <MapPin
                          className="text-brand shrink-0"
                          width={18}
                          height={18}
                        />
                        <div className="flex flex-col items-start gap-1">
                          <span className="fluid-sm text-foreground font-semibold">{ort.name}</span>
                          {renderRetiredBadge(ort)}
                        </div>
                      </div>
                    </Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderAddress(ort)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderMietpreis(ort)}</Table.Cell>

                    <Table.Cell className="px-6 py-4">{renderActions(ort)}</Table.Cell>
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
