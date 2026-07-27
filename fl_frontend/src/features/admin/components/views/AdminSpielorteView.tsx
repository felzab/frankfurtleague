"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { formatAddressFull, formatMapsLink } from "@/shared/utils/format";
import { Calendar, Copy, Globe, Magnifier, MapPin, Pencil, TrashBin } from "@gravity-ui/icons";
import Fuse from "fuse.js";

import { Button, Input, Table, toast, Tooltip } from "@heroui/react";

import { AdminCreateSpielortModal } from "../modals/AdminCreateSpielortModal";
import { AdminDeleteSpielortModal } from "../modals/AdminDeleteSpielortModal";
import { AdminEditSpielortModal } from "../modals/AdminEditSpielortModal";

import type { FLSpielort } from "@/features/spielorte/schemas";

export function AdminSpielorteView({ spielorte }: { spielorte: FLSpielort[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const spielortQuery = searchParams.get("q") || "";
  const [inputValue, setInputValue] = useState(spielortQuery);
  const [editingOrt, setEditingOrt] = useState<FLSpielort | null>(null);
  const [deletingOrt, setDeletingOrt] = useState<FLSpielort | null>(null);

  // Sync local input if URL changes externally (e.g., browser back/forward buttons)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInputValue(spielortQuery);
  }, [spielortQuery]);

  // Debouncing-Logic (Updates URL lazily after 300ms)
  useEffect(() => {
    const timer = setTimeout(() => {
      if (spielortQuery === inputValue) return;

      const params = new URLSearchParams(searchParams);
      if (inputValue) {
        params.set("q", inputValue);
      } else {
        params.delete("q");
      }
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    }, 300);

    return () => clearTimeout(timer);
  }, [inputValue, router, pathname, searchParams, spielortQuery]);

  const fuse = new Fuse(spielorte, {
    keys: ["name", "address.plz", "address.strasse", "address.stadtteil"],
    threshold: 0.3,
    distance: 100,
    ignoreLocation: true,
    minMatchCharLength: 1,
  });

  const filteredSpielorte = !spielortQuery ? spielorte : fuse.search(spielortQuery).map((result) => result.item);

  const handleCopyAddress = (ort: FLSpielort) => {
    navigator.clipboard
      .writeText(`${ort.name}, ${formatAddressFull(ort.address)}`)
      .then(() => toast.success("Adresse in die Zwischenablage kopiert!"))
      .catch(() => toast.danger("Fehler beim Kopieren der Adresse."));
  };

  const formatCurrency = (value: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(value);

  return (
    <div className="mx-auto flex h-full w-full max-w-[1400px] flex-col gap-8 overflow-y-auto p-6 sm:p-8">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col">
          <h1 className="text-fluid-xl text-foreground font-extrabold tracking-tight">Spielorte</h1>
          <p className="text-fluid-sm text-foreground-muted mt-1 font-medium">Verwalte alle Austragungsorte und deren Infrastruktur.</p>
        </div>
        <AdminCreateSpielortModal />
      </div>

      {/* Toolbar / Search - Keeping the interactive focus design you liked */}
      <div className="bg-surface border-border focus-within:border-brand flex h-12 w-full max-w-md items-center gap-3 rounded-xl border px-4 py-2.5 shadow-sm transition-colors lg:h-15">
        <Magnifier
          className="text-foreground-muted shrink-0"
          width={18}
          height={18}
        />
        <Input
          type="text"
          value={inputValue}
          placeholder="Suchen nach Name, Straße, PLZ, Stadtteil..."
          variant="secondary"
          className="text-fluid-sm w-full border-none bg-transparent pl-0 outline-none focus-visible:ring-0 sm:pl-1"
          onChange={(e) => setInputValue(e.target.value)}
        />
      </div>
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

            <Table.Body
              renderEmptyState={() => (
                <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                  <p className="text-fluid-sm text-foreground-muted font-medium">
                    {spielortQuery ? "Keine Spielorte für diese Suche gefunden." : "Es wurden noch keine Spielorte angelegt."}
                  </p>
                </div>
              )}>
              {filteredSpielorte.map((ort) => (
                <Table.Row
                  key={ort.id}
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
                      {formatCurrency(ort.default_mietpreis)}
                    </span>
                  </Table.Cell>

                  <Table.Cell className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <Tooltip>
                        <Tooltip.Trigger>
                          <Link
                            href={formatMapsLink(ort)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-foreground-muted hover:bg-muted/40 hover:text-brand focus-visible:ring-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2">
                            <Globe
                              width={18}
                              height={18}
                            />
                          </Link>
                        </Tooltip.Trigger>
                        <Tooltip.Content
                          placement="top"
                          className="bg-surface border-border rounded-lg border px-2 py-1 text-xs shadow-md">
                          Auf Maps öffnen
                        </Tooltip.Content>
                      </Tooltip>

                      <Tooltip>
                        <Tooltip.Trigger>
                          <Link
                            href={`/admin/spielsuche?q=${encodeURIComponent(ort.name)}`}
                            className="text-foreground-muted hover:bg-muted/40 hover:text-brand focus-visible:ring-brand flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors outline-none focus-visible:ring-2">
                            <Calendar
                              width={18}
                              height={18}
                            />
                          </Link>
                        </Tooltip.Trigger>
                        <Tooltip.Content
                          placement="top"
                          className="bg-surface border-border rounded-lg border px-2 py-1 text-xs shadow-md">
                          Spiele anzeigen
                        </Tooltip.Content>
                      </Tooltip>

                      <Tooltip>
                        <Tooltip.Trigger>
                          <Button
                            isIconOnly
                            variant="ghost"
                            className="text-foreground-muted hover:text-brand transition-colors"
                            onPress={() => handleCopyAddress(ort)}>
                            <Copy
                              width={18}
                              height={18}
                            />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content
                          placement="top"
                          className="bg-surface border-border rounded-lg border px-2 py-1 text-xs shadow-md">
                          Adresse kopieren
                        </Tooltip.Content>
                      </Tooltip>

                      <Tooltip>
                        <Tooltip.Trigger>
                          <Button
                            isIconOnly
                            variant="ghost"
                            className="text-foreground-muted hover:text-brand transition-colors"
                            onPress={() => setEditingOrt(ort)}>
                            <Pencil
                              width={18}
                              height={18}
                            />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content
                          placement="top"
                          className="bg-surface border-border rounded-lg border px-2 py-1 text-xs shadow-md">
                          Bearbeiten
                        </Tooltip.Content>
                      </Tooltip>

                      <Tooltip>
                        <Tooltip.Trigger>
                          <Button
                            isIconOnly
                            variant="ghost"
                            className="text-foreground-muted hover:bg-danger/10 hover:text-danger transition-colors"
                            onPress={() => setDeletingOrt(ort)}>
                            <TrashBin
                              width={18}
                              height={18}
                            />
                          </Button>
                        </Tooltip.Trigger>
                        <Tooltip.Content
                          placement="top"
                          className="bg-surface border-border text-danger rounded-lg border px-2 py-1 text-xs shadow-md">
                          Löschen
                        </Tooltip.Content>
                      </Tooltip>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      <AdminEditSpielortModal
        ortData={editingOrt}
        isOpen={editingOrt !== null}
        onClose={() => setEditingOrt(null)}
      />

      <AdminDeleteSpielortModal
        ortData={deletingOrt}
        isOpen={deletingOrt !== null}
        onClose={() => setDeletingOrt(null)}
      />
    </div>
  );
}
