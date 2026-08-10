"use client";

import { memo, useTransition } from "react";
import { useSearchParams } from "next/navigation";

import { Pencil, Person } from "@gravity-ui/icons";

import { Table } from "@heroui/react";

import { reactivateSaisonSpielerAction, reactivateSpielerAction } from "@/features/spieler/actions";
import { LABEL_BADGE } from "@/shared/components/ui/badges";
import { card } from "@/shared/components/ui/card";
import { IconTooltip } from "@/shared/components/ui/IconTooltip";
import { RowActionDelete, RowActionLink, RowActionRestore, RowActions } from "@/shared/components/ui/RowActions";
import { appToast } from "@/shared/utils/appToast";
import { formatSpielDatum } from "@/shared/utils/format";

import type { AdminSpielerRow } from "../../types";

/**
 * The team Kürzel chip. Declared once because the phone layout's captain marker has to be the exact
 * same box (decided 2026-08-07) — two hand-written copies would drift the moment either is touched.
 */
const SHORTHAND_CHIP =
  "bg-brand/50 text-foreground fluid-xs inline-flex w-10 shrink-0 items-center justify-center rounded-md py-1 font-extrabold tracking-wide";

/**
 * Memoised, and load-bearing — see the collection-identity note in `AdminCrudView`: the `items` +
 * render-function form of `Table.Body` is what keeps the rows alive across hidden re-renders, and
 * `memo` is the cheap second layer.
 *
 * **The rows are every player; the Team, Nummer and Status columns are the selected season's.** A
 * player with no squad row in that season is listed too, showing that instead of squad data — which
 * is the state the memberships read exists to make visible and the season-scoped read cannot.
 *
 * **Two independent retirements meet on one row** (ADR-0025), and keeping them apart is this
 * component's main job. The trash control retires the PERSON; a retired SQUAD ROW is badged with its
 * own restore control beside it, because reviving a row is a different endpoint that preserves the
 * number, position and stufe the row still carries. A row can be in either state, both, or neither.
 */
export const AdminSpielerTable = memo(function AdminSpielerTable({
  spielerQuery,
  filteredSpieler,
  selectedSaisonId,
  selectedSaisonStatus,
  setDeletingSpieler,
}: {
  spielerQuery: string;
  filteredSpieler: AdminSpielerRow[];
  /** Which season the squad columns describe — the sidemenu selector's, resolved by the page. */
  selectedSaisonId: string;
  /** Decides the status column's wording: Laufend, Abgeschlossen or Geplant, the season's own three. */
  selectedSaisonStatus: "past" | "active" | "future";
  setDeletingSpieler: (spieler: AdminSpielerRow) => void;
}) {
  const [, startReactivating] = useTransition();

  // The selector's season rides along on every row link, so the editor opens on the season this list
  // is showing. Reading it here is safe: the parent view already subscribes this tree to the router.
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("saison_id");
  const saisonQuery = selectedFromUrl ? `?saison_id=${encodeURIComponent(selectedFromUrl)}` : "";

  // One press, then a toast either way. No confirmation step: reactivation is undone by the delete
  // control that takes its place.
  const handleReactivatePerson = (spieler: AdminSpielerRow) => {
    startReactivating(async () => {
      const res = await reactivateSpielerAction({ id: spieler.id });
      if (res.success) appToast.success(res.message ?? "Spieler reaktiviert!");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error });
    });
  };

  const handleReactivateRow = (spieler: AdminSpielerRow) => {
    startReactivating(async () => {
      const res = await reactivateSaisonSpielerAction({ spieler_id: spieler.id, saison_id: selectedSaisonId });
      if (res.success) appToast.success(res.message ?? "Kadereintrag reaktiviert!");
      else appToast.danger("Reaktivieren fehlgeschlagen", { description: res.error });
    });
  };

  // One source for both layouts: the `md+` table's cells and the phone cards render these, so the
  // two presentations cannot disagree about a row's state or its controls.
  const renderStatusBadges = (spieler: AdminSpielerRow) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {spieler.inactive_since !== null && (
        <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Stillgelegt seit {formatSpielDatum(spieler.inactive_since)}</span>
      )}
      {spieler.selected === null && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Nicht im Kader</span>}
      {spieler.selected?.inactive_since != null && (
        <span className={`${LABEL_BADGE} bg-warning/15 text-warning-strong`}>
          Ausgetragen seit {formatSpielDatum(spieler.selected.inactive_since)}
        </span>
      )}
      {spieler.selected?.is_nachgetragen === true && spieler.selected.inactive_since === null && (
        <IconTooltip label="Der Spieler kam erst nach dem Start der Saison dazu.">
          <span className={`${LABEL_BADGE} bg-info/15 text-info-strong cursor-help`}>Nachgetragen</span>
        </IconTooltip>
      )}
      {spieler.inactive_since === null && spieler.selected !== null && spieler.selected.inactive_since === null && (
        <>
          {/* The season's own three words, not a fourth set for this row (decided 2026-08-10). „Aktiv“
              here also meant „nicht stillgelegt“ in the filter above, which is a different fact about a
              different subject; „Laufend“ leaves that word to the filter alone. */}
          {selectedSaisonStatus === "active" && <span className={`${LABEL_BADGE} bg-success/15 text-success-strong`}>Laufend</span>}
          {selectedSaisonStatus === "past" && <span className={`${LABEL_BADGE} bg-muted text-foreground-muted`}>Abgeschlossen</span>}
          {selectedSaisonStatus === "future" && <span className={`${LABEL_BADGE} bg-info/15 text-info-strong`}>Geplant</span>}
        </>
      )}
    </div>
  );

  const renderActions = (spieler: AdminSpielerRow) => (
    <RowActions>
      <RowActionLink
        href={`/admin/spieler/${spieler.id}${saisonQuery}`}
        label="Bearbeiten"
        ariaLabel={`Spieler ${spieler.fullName} bearbeiten`}>
        <Pencil
          aria-hidden="true"
          width={18}
          height={18}
        />
      </RowActionLink>

      {/* The SQUAD ROW's restore, offered only where there is a retired row to restore. Distinct
          from the person's below, and it preserves the number, position and stufe (ADR-0025). */}
      {spieler.selected?.inactive_since != null && (
        <RowActionRestore
          label="Kadereintrag reaktivieren"
          ariaLabel={`Kadereintrag von ${spieler.fullName} reaktivieren`}
          onPress={() => handleReactivateRow(spieler)}
        />
      )}

      {spieler.inactive_since !== null ? (
        <RowActionRestore
          label="Spieler reaktivieren"
          ariaLabel={`Spieler ${spieler.fullName} reaktivieren`}
          onPress={() => handleReactivatePerson(spieler)}
        />
      ) : (
        <RowActionDelete
          label="Stilllegen"
          ariaLabel={`Spieler ${spieler.fullName} stilllegen`}
          onPress={() => setDeletingSpieler(spieler)}
        />
      )}
    </RowActions>
  );

  /**
   * The captain's armband, as a chip beside the name (decided 2026-08-07).
   *
   * `C` rather than "Kapitän": it is the marker the squad sheets already used — the six live rows
   * carried it inside the name field for want of anywhere else to put it — and the tooltip carries
   * the word for anyone who does not know the convention.
   */
  const renderCaptain = (spieler: AdminSpielerRow) =>
    spieler.selected?.is_captain === true ? <span className={`${LABEL_BADGE} bg-brand/50 text-foreground shrink-0`}>Kapitän</span> : null;

  /** The phone layout's marker: the Kürzel chip's exact box, carrying the armband's letter. */
  const renderCaptainCompact = (spieler: AdminSpielerRow) =>
    spieler.selected?.is_captain === true ? (
      <IconTooltip label="Kapitän dieser Mannschaft">
        <span className={`${SHORTHAND_CHIP} cursor-help`}>C</span>
      </IconTooltip>
    ) : null;

  const emptyState = (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="fluid-sm text-foreground-muted font-medium">
        {spielerQuery ? "Keine Spieler für diese Suche gefunden." : "Es wurden noch keine Spieler angelegt."}
      </p>
    </div>
  );

  /**
   * The squad number's chip — EMPTY rather than absent when the player has none (decided 2026-08-07).
   * A player without a number is normal, not an error, and a missing chip left a ragged hole in the
   * column while every neighbouring row had one. The empty chip holds the column's rhythm and reads
   * as "not filled in" rather than as a rendering fault.
   */
  const renderNummer = (spieler: AdminSpielerRow) => (
    <span
      aria-label={spieler.selected?.nummer ? undefined : "Keine Nummer"}
      // A fixed height rather than padding, so the empty chip is the same box as a filled one
      // (decided 2026-08-07). `py-1.5` sizes the chip from its line box, and an empty span has none.
      className={`fluid-xs inline-flex h-7 w-10 shrink-0 items-center justify-center rounded-md font-extrabold tracking-wide ${
        spieler.selected?.nummer ? "bg-muted text-foreground" : "bg-muted/50"
      }`}>
      {spieler.selected?.nummer ?? ""}
    </span>
  );

  return (
    <>
      {/* The phone layout: one card per player, no horizontal scrolling anywhere. The table below
          `md` forced the whole grid sideways; a stacked card holds the same data and the same
          controls at reading width. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {filteredSpieler.length === 0 && <div className={`${card()} w-full`}>{emptyState}</div>}
        {filteredSpieler.map((spieler) => (
          <div
            key={spieler.id}
            className={`${card()} flex w-full flex-col gap-y-3 p-4 ${spieler.inactive_since !== null ? "opacity-80" : ""}`}>
            <div className="flex w-full flex-row items-center gap-3">
              {renderNummer(spieler) ?? (
                <span
                  className="w-10 shrink-0"
                  aria-hidden="true"
                />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="fluid-sm text-foreground truncate font-semibold">{spieler.fullName}</span>
                <span className="fluid-xs text-foreground-muted truncate">
                  {spieler.selected?.teamName ?? "Kein Team in dieser Saison"}
                  {spieler.selected?.position ? ` · ${spieler.selected.position}` : ""}
                  {spieler.selected?.stufe ? ` · ${spieler.selected.stufe}` : ""}
                </span>
              </div>
              {renderCaptainCompact(spieler)}
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">{renderStatusBadges(spieler)}</div>
            <div className="border-border/50 -mx-1 border-t pt-2">{renderActions(spieler)}</div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <Table className={`${card()} h-fit w-full p-0`}>
          <Table.ScrollContainer className="scrollbar-hide">
            <Table.Content aria-label="Tabelle aller Spieler">
              <Table.Header>
                <Table.Column
                  isRowHeader
                  className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 font-bold tracking-wider uppercase">
                  Spieler
                </Table.Column>
                {/* The four data columns are PINNED to their content's width with one px-3 inset
                each, so every value sits the same distance from its neighbour and the leftover
                width all goes to the name column — the club list's rule, same reasoning. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-16 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Nr.
                </Table.Column>
                {/* Season-scoped columns; WHICH season is the sidemenu selector's, stated by the page
                context rather than repeated per header. */}
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-44 border-b px-3 py-4 pr-6 font-bold tracking-wider uppercase lg:pr-10">
                  Team
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-32 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Position
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-20 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Stufe
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border w-44 border-b px-3 py-4 font-bold tracking-wider uppercase">
                  Status
                </Table.Column>
                <Table.Column className="bg-muted text-foreground-muted fluid-xs border-border border-b px-6 py-4 text-right font-bold tracking-wider uppercase">
                  Aktionen
                </Table.Column>
              </Table.Header>

              {/* `items` + a render function, not mapped children — see the memo note above. */}
              <Table.Body
                items={filteredSpieler}
                renderEmptyState={() => emptyState}>
                {(spieler: AdminSpielerRow) => {
                  const isRetired = spieler.inactive_since !== null;
                  return (
                    <Table.Row
                      id={spieler.id}
                      className="hover:bg-muted/40 border-border/50 border-b transition-colors last:border-b-0">
                      <Table.Cell className="px-6 py-4">
                        <div className={`flex min-w-0 items-center gap-3 ${isRetired ? "opacity-60" : ""}`}>
                          <Person
                            className="text-brand shrink-0"
                            width={18}
                            height={18}
                          />
                          <span className="fluid-sm text-foreground truncate font-semibold">{spieler.fullName}</span>
                          {renderCaptain(spieler)}
                        </div>
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">{renderNummer(spieler)}</Table.Cell>

                      <Table.Cell className="px-3 py-4 pr-6 lg:pr-10">
                        {spieler.selected?.teamName ? (
                          <div className="flex items-center gap-2">
                            {/* The TeamCard's chip colour, so a Kürzel wears one tint everywhere. */}
                            <span className="bg-brand/50 text-foreground fluid-xs inline-flex w-10 shrink-0 items-center justify-center rounded-md py-1 font-extrabold tracking-wide">
                              {spieler.selected.teamShorthand}
                            </span>
                            <span className="fluid-sm text-foreground truncate font-semibold">{spieler.selected.teamName}</span>
                          </div>
                        ) : null}
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">
                        {spieler.selected?.position ? (
                          <span className="fluid-sm text-foreground font-semibold">{spieler.selected.position}</span>
                        ) : null}
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">
                        {spieler.selected?.stufe ? (
                          <span className="fluid-sm text-foreground font-semibold">{spieler.selected.stufe}</span>
                        ) : null}
                      </Table.Cell>

                      <Table.Cell className="px-3 py-4">{renderStatusBadges(spieler)}</Table.Cell>

                      <Table.Cell className="px-6 py-4">{renderActions(spieler)}</Table.Cell>
                    </Table.Row>
                  );
                }}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
        </Table>
      </div>
    </>
  );
});
