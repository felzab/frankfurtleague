import { memo } from "react";
import Link from "next/link";

import { Calendar, Copy, Pencil, Person, TrashBin } from "@gravity-ui/icons";

import { Button, Table, toast, Tooltip } from "@heroui/react";

import { formatEuro } from "@/shared/utils/format";

import type { FLSchiedsrichter } from "../../schemas";

function AdminSchiedsrichterTable({
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
  const handleCopyKontakt = (schiedsrichter: FLSchiedsrichter) => {
    // Collect available contact info cleanly
    const details = [schiedsrichter.name, schiedsrichter.kontakt.email, schiedsrichter.kontakt.telefon].filter(Boolean).join(" | ");

    navigator.clipboard
      .writeText(details)
      .then(() => toast.success("Kontaktdaten in die Zwischenablage kopiert!"))
      .catch(() => toast.danger("Fehler beim Kopieren der Kontaktdaten."));
  };

  return (
    <Table className="bg-surface border-border h-fit w-full rounded-2xl border p-0 shadow-sm">
      <Table.ScrollContainer className="scrollbar-hide">
        <Table.Content aria-label="Tabelle aller Schiedsrichter">
          <Table.Header>
            <Table.Column
              isRowHeader
              className="bg-muted text-foreground-muted text-fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Name
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted text-fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Kontakt
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted text-fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Schule / Verein
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted text-fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
              Std. Honorar
            </Table.Column>
            <Table.Column className="bg-muted text-foreground-muted text-fluid-xs border-border border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
              Aktionen
            </Table.Column>
          </Table.Header>

          {/* `items` + a render function, not mapped children: the static form stops committing its
              row collection after a few client navigations away and back (ledger NEW-T1). */}
          <Table.Body
            items={filteredSchiedsrichter}
            renderEmptyState={() => (
              <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                <p className="text-fluid-sm text-foreground-muted font-medium">
                  {schiedsrichterQuery ? "Keine Schiedsrichter für diese Suche gefunden." : "Es wurden noch keine Schiedsrichter angelegt."}
                </p>
              </div>
            )}>
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
                    <span className="text-fluid-sm text-foreground font-semibold">{schiedsrichter.name}</span>
                  </div>
                </Table.Cell>

                {/* 2. Kontakt (Stacked Email and Phone) */}
                <Table.Cell className="px-6 py-4">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-fluid-sm text-foreground">
                      {schiedsrichter.kontakt.email || <span className="text-foreground-muted/50 italic">Keine E-Mail</span>}
                    </span>
                    <span className="text-fluid-xs text-foreground-muted">
                      {schiedsrichter.kontakt.telefon || <span className="text-foreground-muted/50 italic">Keine Telefonnummer</span>}
                    </span>
                  </div>
                </Table.Cell>

                {/* 3. Schule / Verein */}
                <Table.Cell className="px-6 py-4">
                  <span className="text-fluid-sm text-foreground">
                    {schiedsrichter.schule || <span className="text-foreground-muted/50 italic">—</span>}
                  </span>
                </Table.Cell>

                {/* 4. Honorar */}
                <Table.Cell className="px-6 py-4">
                  <span className="bg-muted text-foreground text-fluid-xs inline-flex items-center rounded-md px-3 py-1.5 font-bold tracking-wide">
                    {formatEuro(schiedsrichter.default_payment)}
                  </span>
                </Table.Cell>

                {/* 5. Aktionen */}
                <Table.Cell className="px-6 py-4">
                  <div className="flex items-center justify-end gap-2">
                    <Tooltip>
                      <Tooltip.Trigger>
                        <Link
                          href={`/admin/spielsuche?q=${encodeURIComponent(schiedsrichter.name)}`}
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
                        Einsätze anzeigen
                      </Tooltip.Content>
                    </Tooltip>
                    <Tooltip>
                      <Tooltip.Trigger>
                        <Button
                          isIconOnly
                          variant="ghost"
                          className="text-foreground-muted hover:text-brand transition-colors"
                          onPress={() => handleCopyKontakt(schiedsrichter)}>
                          <Copy
                            width={18}
                            height={18}
                          />
                        </Button>
                      </Tooltip.Trigger>
                      <Tooltip.Content
                        placement="top"
                        className="bg-surface border-border rounded-lg border px-2 py-1 text-xs shadow-md">
                        Kontaktdaten kopieren
                      </Tooltip.Content>
                    </Tooltip>

                    <Tooltip>
                      <Tooltip.Trigger>
                        <Button
                          isIconOnly
                          variant="ghost"
                          className="text-foreground-muted hover:text-brand transition-colors"
                          onPress={() => setEditingSchiedsrichter(schiedsrichter)}>
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
                          onPress={() => setDeletingSchiedsrichter(schiedsrichter)}>
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
            )}
          </Table.Body>
        </Table.Content>
      </Table.ScrollContainer>
    </Table>
  );
}

/**
 * Memoised deliberately, and load-bearing — see the long note on `AdminSpielorteTable`. In short:
 * the parent's `useSearchParams()` re-renders this table while it sits hidden in a React Activity
 * tree during navigation elsewhere, and a react-aria collection that re-renders while hidden loses
 * its rows for good. Every prop must stay referentially stable; no inline lambdas here.
 */
export default memo(AdminSchiedsrichterTable);
