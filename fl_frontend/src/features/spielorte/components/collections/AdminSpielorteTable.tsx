"use client";

import { memo, useTransition } from "react";
import { useSearchParams } from "next/navigation";

import { Calendar, Globe, MapPin, Pencil } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateSpielortAction } from "@/features/spielorte/actions";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { CLIPBOARD_ERROR_DETAIL, CLIPBOARD_ERROR_TITLE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatAddressFull, formatEuro, formatSpielDatum } from "@/shared/utils/format";

import { formatMapsLink } from "../../utils";

import type { FLSpielort } from "../../schemas";

/**
 * Memoised deliberately, and load-bearing: see the collection-identity note in `AdminCrudView`.
 *
 * The parent view calls `useSearchParams()`, which subscribes it to the client router. Next keeps
 * the previous route mounted in a hidden React Activity tree for instant back-navigation, so every
 * navigation *elsewhere* re-renders this table while it is hidden. A react-aria collection that
 * re-renders while hidden drops its rows and never rebuilds them on restore, leaving the table
 * shell with neither rows nor `renderEmptyState`. Bisected against seven probe routes: the table
 * alone is fine, `useSearchParams` alone is fine, the two together fail on the third visit.
 *
 * `memo` keeps that churn down, but note what it does *not* do: `spielortQuery` is read from the
 * live router, and a hidden tree still sees the incoming route's params, so leaving this page for
 * one whose `q` differs changes the prop and the memo cannot bail out — and `useSearchParams` below
 * subscribes this table to the router directly, so any parameter change re-renders it too. Measured
 * over 15 such round trips with the query varying each time: the rows survive. What carries the fix
 * is the `items` + render-function form of `Table.Body` below; `memo` is the cheap second layer.
 * **Do not pass an inline lambda or a freshly-built array here**, and do not convert `Table.Body`
 * back to mapped children.
 */
export const AdminSpielorteTable = memo(function AdminSpielorteTable({
  spielortQuery,
  filteredSpielorte,
  setDeletingOrt,
}: {
  spielortQuery: string;
  filteredSpielorte: FLSpielort[];
  setDeletingOrt: (ort: FLSpielort) => void;
}) {
  const [, startReactivating] = useTransition();

  // The sidemenu's season rides along, so the fixture list opens on the season the admin is working
  // in rather than on the current one. Reading it here is safe: the parent view already subscribes
  // this tree to the router.
  const searchParams = useSearchParams();
  const selectedSaisonId = searchParams.get("saison_id");
  const saisonParam = selectedSaisonId ? `&saison_id=${encodeURIComponent(selectedSaisonId)}` : "";

  const handleCopyAddress = async (ort: FLSpielort) => {
    const copied = await copyTextToClipboard(`${ort.name}, ${formatAddressFull(ort.address)}`);

    if (copied) appToast.success("Adresse kopiert");
    else appToast.danger(CLIPBOARD_ERROR_TITLE, { description: CLIPBOARD_ERROR_DETAIL });
  };

  // One press, then a toast either way. No confirmation step: the reactivation is undone by the
  // retire control that takes its place — the teams table's arrangement, on the same endpoint shape.
  const handleReactivate = (ort: FLSpielort) => {
    startReactivating(async () => {
      const res = await reactivateSpielortAction({ id: ort.id });
      if (res.success) appToast.success(res.message ?? "Spielort reaktiviert.");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error ?? "Ein unerwarteter Fehler ist aufgetreten." });
    });
  };

  // One source for both layouts, the teams table's pattern: the `md+` table's cells and the phone
  // cards render these, so the two presentations cannot disagree about a row or its controls.
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

  // Stated beside the identity rather than in a column of its own: retirement is the only state a
  // venue has, so a column would be empty on every live row.
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
      {/* `ort` as `buildSpielFacets` declares it, carrying the id its options are keyed by: a `q=`
          here fuzzy-matches every `SEARCH_KEYS` entry, the venue's maps link among them, and lights no chip. */}
      <RowActionLink
        href={`/admin/spielsuche?ort=${ort.id}${saisonParam}`}
        label="Spiele anzeigen"
        ariaLabel={`Spiele in ${ort.name} anzeigen`}>
        <Calendar
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
      {/* A link rather than a press: the venue form edits on a page, so the pencil is a
          navigation and the shared view renders no edit overlay. */}
      <RowActionLink
        href={`/admin/spielorte/${ort.id}`}
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

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="fluid-sm text-foreground-muted font-medium">
        {spielortQuery ? "Keine Spielorte für diese Suche gefunden." : "Es wurden noch keine Spielorte angelegt."}
      </p>
    </div>
  );

  return (
    <>
      {/* The phone layout: one card per venue, no horizontal scrolling anywhere (decided 2026-08-07
          — the teams table's card pattern, applied here). */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSpielorte.length === 0 && <div className={`${card()} w-full`}>{emptyState}</div>}
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
          <Table.ScrollContainer className="scrollbar-hide">
            <Table.Content aria-label="Tabelle aller Spielorte">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Name
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Adresse
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Std. Mietpreis
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children: the static form stops committing its
                  row collection after a few client navigations away and back. */}
              <Table.Body
                items={filteredSpielorte}
                renderEmptyState={() => emptyState}>
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
