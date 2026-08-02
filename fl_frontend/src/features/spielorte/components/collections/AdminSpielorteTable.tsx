import { memo } from "react";

import { Calendar, Globe, MapPin } from "@gravity-ui/icons";

import { Table, toast } from "@heroui/react";

import { card } from "@/shared/components/ui/card";
import { RowActionCopy, RowActionDelete, RowActionEdit, RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { CLIPBOARD_ERROR_MESSAGE, copyTextToClipboard } from "@/shared/utils/clipboard";
import { formatAddressFull, formatEuro } from "@/shared/utils/format";

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
 * live router, and a hidden tree still sees the incoming route's params, so navigating to a URL
 * with a different `q` (the "Einsätze anzeigen" link below does exactly that) changes the prop and
 * the memo cannot bail out. Measured over 15 such round trips with the query varying each time:
 * the rows survive. What actually carries the fix is the `items` + render-function form of
 * `Table.Body` below; `memo` is the cheap second layer. **Do not pass an inline lambda or a
 * freshly-built array here**, and do not convert `Table.Body` back to mapped children.
 */
export const AdminSpielorteTable = memo(function AdminSpielorteTable({
  spielortQuery,
  filteredSpielorte,
  setEditingOrt,
  setDeletingOrt,
}: {
  spielortQuery: string;
  filteredSpielorte: FLSpielort[];
  setEditingOrt: (ort: FLSpielort) => void;
  setDeletingOrt: (ort: FLSpielort) => void;
}) {
  const handleCopyAddress = async (ort: FLSpielort) => {
    const copied = await copyTextToClipboard(`${ort.name}, ${formatAddressFull(ort.address)}`);

    if (copied) toast.success("Adresse in die Zwischenablage kopiert!");
    else toast.danger(CLIPBOARD_ERROR_MESSAGE);
  };

  return (
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
            renderEmptyState={() => (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <p className="fluid-sm text-foreground-muted font-medium">
                  {spielortQuery ? "Keine Spielorte für diese Suche gefunden." : "Es wurden noch keine Spielorte angelegt."}
                </p>
              </div>
            )}>
            {(ort: FLSpielort) => (
              <Table.Row
                id={ort.id}
                className="hover:bg-muted/40 border-border/50 border-b transition-colors last:border-b-0">
                <Table.Cell className="px-6 py-4">
                  <div className="flex items-center gap-3">
                    <MapPin
                      className="text-brand shrink-0"
                      width={18}
                      height={18}
                    />
                    <span className="fluid-sm text-foreground font-semibold">{ort.name}</span>
                  </div>
                </Table.Cell>

                <Table.Cell className="px-6 py-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="fluid-sm text-foreground">
                      {ort.address.strasse} {ort.address.hausnummer}
                    </span>
                    <span className="fluid-xs text-foreground-muted">
                      {ort.address.plz} {ort.address.stadt}
                      {ort.address.stadtteil && ` (${ort.address.stadtteil})`}
                    </span>
                  </div>
                </Table.Cell>

                <Table.Cell className="px-6 py-4">
                  <span className="bg-muted text-foreground fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-bold tracking-wide">
                    {formatEuro(ort.default_mietpreis)}
                  </span>
                </Table.Cell>

                <Table.Cell className="px-6 py-4">
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
                    <RowActionLink
                      href={`/admin/spielsuche?q=${encodeURIComponent(ort.name)}`}
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
                    <RowActionEdit
                      label="Bearbeiten"
                      ariaLabel={`Spielort ${ort.name} bearbeiten`}
                      onPress={() => setEditingOrt(ort)}
                    />
                    <RowActionDelete
                      label="Löschen"
                      ariaLabel={`Spielort ${ort.name} löschen`}
                      onPress={() => setDeletingOrt(ort)}
                    />
                  </RowActions>
                </Table.Cell>
              </Table.Row>
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
});
