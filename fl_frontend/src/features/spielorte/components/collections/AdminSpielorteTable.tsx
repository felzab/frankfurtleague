import { memo } from "react";

import { Calendar, Globe, MapPin } from "@gravity-ui/icons";

import { Table, toast } from "@heroui/react";

import { RowActionCopy, RowActionDelete, RowActionEdit, RowActionLink, RowActions } from "@/shared/components/ui/RowActions";
import { formatAddressFull, formatEuro } from "@/shared/utils/format";

import { formatMapsLink } from "../../utils";

import type { FLSpielort } from "../../schemas";

function AdminSpielorteTable({
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
  const handleCopyAddress = (ort: FLSpielort) => {
    navigator.clipboard
      .writeText(`${ort.name}, ${formatAddressFull(ort.address)}`)
      .then(() => toast.success("Adresse in die Zwischenablage kopiert!"))
      .catch(() => toast.danger("Fehler beim Kopieren der Adresse."));
  };

  return (
    <Table className="bg-surface border-border h-fit w-full rounded-2xl border p-0 shadow-sm">
      <Table.ScrollContainer className="scrollbar-hide">
        <Table.Content aria-label="Tabelle aller Spielorte">
          <Table.Header>
            <Table.Column
              isRowHeader
              className="bg-muted text-foreground-muted text-fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Name
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted text-fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Adresse
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted text-fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Std. Mietpreis
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted text-fluid-xs border-border border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
              Aktionen
            </Table.Column>
          </Table.Header>

          {/* `items` + a render function, not mapped children: the static form stops committing its
              row collection after a few client navigations away and back (ledger NEW-T1). */}
          <Table.Body
            items={filteredSpielorte}
            renderEmptyState={() => (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <p className="text-fluid-sm text-foreground-muted font-medium">
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
                    <span className="text-fluid-sm text-foreground font-semibold">{ort.name}</span>
                  </div>
                </Table.Cell>

                <Table.Cell className="px-6 py-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-fluid-sm text-foreground">
                      {ort.address.strasse} {ort.address.hausnummer}
                    </span>
                    <span className="text-fluid-xs text-foreground-muted">
                      {ort.address.plz} {ort.address.stadt}
                      {ort.address.stadtteil && ` (${ort.address.stadtteil})`}
                    </span>
                  </div>
                </Table.Cell>

                <Table.Cell className="px-6 py-4">
                  <span className="bg-muted text-foreground text-fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-bold tracking-wide">
                    {formatEuro(ort.default_mietpreis)}
                  </span>
                </Table.Cell>

                <Table.Cell className="px-6 py-4">
                  <RowActions>
                    <RowActionLink
                      href={formatMapsLink(ort)}
                      label="Auf Maps öffnen"
                      external>
                      <Globe
                        width={18}
                        height={18}
                      />
                    </RowActionLink>
                    <RowActionLink
                      href={`/admin/spielsuche?q=${encodeURIComponent(ort.name)}`}
                      label="Spiele anzeigen">
                      <Calendar
                        width={18}
                        height={18}
                      />
                    </RowActionLink>
                    <RowActionCopy
                      label="Adresse kopieren"
                      onPress={() => handleCopyAddress(ort)}
                    />
                    <RowActionEdit
                      label="Bearbeiten"
                      onPress={() => setEditingOrt(ort)}
                    />
                    <RowActionDelete
                      label="Löschen"
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
}

/**
 * Memoised deliberately, and load-bearing — this is the NEW-T1 fix.
 *
 * The parent view calls `useSearchParams()`, which subscribes it to the client router. Next keeps
 * the previous route mounted in a hidden React Activity tree for instant back-navigation, so every
 * navigation *elsewhere* re-renders this table while it is hidden. A react-aria collection that
 * re-renders while hidden drops its rows and never rebuilds them on restore, leaving the table
 * shell with neither rows nor `renderEmptyState`. Bisected against seven probe routes: the table
 * alone is fine, `useSearchParams` alone is fine, the two together fail on the third visit.
 *
 * Every prop must therefore stay referentially stable across those re-renders: `filteredSpielorte`
 * comes from `useFuzzySearch`'s memo, and the two setters are `useState` setters. **Do not pass an
 * inline lambda or a freshly-built array here** — it silently restores the bug.
 */
export default memo(AdminSpielorteTable);
